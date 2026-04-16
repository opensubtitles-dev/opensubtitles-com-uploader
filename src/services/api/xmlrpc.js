import {
  API_ENDPOINTS,
  CACHE_KEYS,
  DEFAULT_SETTINGS,
  getApiHeaders,
} from '../../utils/constants.js';
import { CacheService } from '../cache.js';
import { retryAsync } from '../../utils/retryUtils.js';
import { delayedFetch } from '../../utils/networkUtils.js';
import { logSessionDetection } from '../../utils/sessionUtils.js';
import { logSensitiveData } from '../../utils/securityUtils.js';

/**
 * OpenSubtitles XML-RPC API service
 */
export class XmlRpcService {
  // Request deduplication - prevent multiple simultaneous identical requests
  static activeRequests = new Map();

  // Store anonymous token for anonymous uploads
  static anonymousToken = null;

  /**
   * Perform anonymous login to get a session token
   * @returns {Promise<string>} - Anonymous session token
   */
  static async anonymousLogin() {
    // If we already have an anonymous token, return it
    if (this.anonymousToken) {
      console.log('🔒 Using existing anonymous token');
      return this.anonymousToken;
    }

    try {
      console.log('🔒 Performing anonymous login...');

      const xmlRpcBody = `<?xml version="1.0"?>
<methodCall>
  <methodName>LogIn</methodName>
  <params>
    <param><value><string></string></value></param>
    <param><value><string></string></value></param>
    <param><value><string>en</string></value></param>
    <param><value><string>OpenSubtitles Uploader PRO</string></value></param>
  </params>
</methodCall>`;

      const response = await delayedFetch(API_ENDPOINTS.OPENSUBTITLES_XMLRPC, {
        method: 'POST',
        headers: getApiHeaders('text/xml'),
        body: xmlRpcBody,
      });

      if (!response.ok) {
        throw new Error(`Anonymous login failed: ${response.status} ${response.statusText}`);
      }

      const xmlText = await response.text();
      const xmlDoc = this.parseXmlRpcResponse(xmlText);

      // Extract token from response - use the existing extractStructData method
      const responseStruct = xmlDoc.querySelector('methodResponse param value struct');
      if (!responseStruct) {
        console.error('❌ Invalid anonymous login response structure');
        console.error('Raw XML:', xmlText);
        throw new Error('Invalid anonymous login response structure');
      }

      const result = this.extractStructData(responseStruct);

      // Get token from result
      const token = result.token;

      if (!token) {
        console.error('❌ Anonymous login response missing token');
        console.error('Response data:', result);
        throw new Error('Anonymous login response missing token');
      }

      // Store the anonymous token for reuse
      this.anonymousToken = token;
      console.log('✅ Anonymous login successful, token received');

      return token;
    } catch (error) {
      console.error('❌ Anonymous login failed:', error);
      throw error;
    }
  }

  /**
   * Clear stored anonymous token
   * Call this when switching from anonymous to authenticated mode
   */
  static clearAnonymousToken() {
    if (this.anonymousToken) {
      console.log('🔒 Clearing anonymous token');
      this.anonymousToken = null;
    }
  }

  /**
   * Get authentication token using unified session detection
   */
  static getAuthToken() {
    // Use unified session detection system
    const sessionDetection = logSessionDetection('XML-RPC Service');

    if (sessionDetection.sessionId) {
      logSensitiveData(
        `🔑 XML-RPC: ✅ Using session from ${sessionDetection.source}`,
        sessionDetection.sessionId,
        'session'
      );
      return sessionDetection.sessionId;
    }

    console.log('🔑 XML-RPC: No session found, using empty string');
    return '';
  }

  /**
   * Parse XML-RPC response
   */
  static parseXmlRpcResponse(xmlText) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

    const parseError = xmlDoc.querySelector('parsererror');
    if (parseError) {
      throw new Error(`XML parsing failed: ${parseError.textContent}`);
    }

    return xmlDoc;
  }

  /**
   * Extract struct data from XML (now handles nested structures)
   */
  static extractStructData(structElement) {
    const data = {};
    const members = structElement.querySelectorAll(':scope > member'); // Only direct children

    members.forEach(member => {
      const name = member.querySelector('name')?.textContent;
      const valueElement = member.querySelector('value');

      if (name && valueElement) {
        // Check for different value types
        const stringValue = valueElement.querySelector('string')?.textContent;
        const intValue = valueElement.querySelector('int')?.textContent;
        const doubleValue = valueElement.querySelector('double')?.textContent;
        const nestedStruct = valueElement.querySelector('struct');
        const nestedArray = valueElement.querySelector('array');

        if (nestedStruct) {
          // Recursively extract nested struct - check this FIRST
          data[name] = this.extractStructData(nestedStruct);
        } else if (nestedArray) {
          // Extract array data
          data[name] = this.extractArrayData(nestedArray);
        } else if (stringValue !== undefined) {
          data[name] = stringValue;
        } else if (intValue !== undefined) {
          data[name] = intValue;
        } else if (doubleValue !== undefined) {
          data[name] = doubleValue;
        } else {
          // Fallback to text content
          const textValue = valueElement.textContent?.trim();
          if (textValue) {
            data[name] = textValue;
          }
        }
      }
    });

    return data;
  }

  /**
   * Extract array data from XML
   */
  static extractArrayData(arrayElement) {
    const arrayData = [];
    const dataElement = arrayElement.querySelector('data');

    if (dataElement) {
      const values = dataElement.querySelectorAll(':scope > value'); // Only direct children

      values.forEach(valueElement => {
        const stringValue = valueElement.querySelector('string')?.textContent;
        const intValue = valueElement.querySelector('int')?.textContent;
        const nestedStruct = valueElement.querySelector('struct');
        const nestedArray = valueElement.querySelector('array');

        if (stringValue !== undefined) {
          arrayData.push(stringValue);
        } else if (intValue !== undefined) {
          arrayData.push(intValue);
        } else if (nestedStruct) {
          arrayData.push(this.extractStructData(nestedStruct));
        } else if (nestedArray) {
          arrayData.push(this.extractArrayData(nestedArray));
        } else {
          const textValue = valueElement.textContent?.trim();
          if (textValue) {
            arrayData.push(textValue);
          }
        }
      });
    }

    return arrayData;
  }

  // Note: login() method removed - all other XML-RPC methods use PHPSESSID cookie authentication
  // Note: getSubLanguages() removed in Phase 2 — replaced by REST `GET /api/v1/infos/languages`
  //       (see src/services/api/languages.js + src/hooks/useLanguageData.js).

  // Note: guessMovieFromString*() removed in Phase 2 — replaced by REST
  //       `POST /api/v1/subtitles/upload/guess` (src/services/api/upload.js).


  /**
   * Get user info using XML-RPC API
   * @returns {Promise<Object>} - User info object
   */
  static async getUserInfo() {
    try {
      const token = this.getAuthToken();

      const xmlRpcBody = `<?xml version="1.0"?>
<methodCall>
  <methodName>GetUserInfo</methodName>
  <params>
    <param><value><string>${token}</string></value></param>
    <param><value><string>1</string></value></param>
  </params>
</methodCall>`;

      const response = await delayedFetch(API_ENDPOINTS.OPENSUBTITLES_XMLRPC, {
        method: 'POST',
        headers: getApiHeaders('text/xml'),
        body: xmlRpcBody,
      });

      if (!response.ok) {
        // Handle 401 Unauthorized gracefully - it's expected when user isn't logged in
        if (response.status === 401) {
          return null; // Return null instead of throwing error
        }
        throw new Error(`XML-RPC GetUserInfo failed: ${response.status} ${response.statusText}`);
      }

      const xmlText = await response.text();

      const xmlDoc = this.parseXmlRpcResponse(xmlText);

      // Parse response
      const responseStruct = xmlDoc.querySelector('methodResponse param value struct');
      if (responseStruct) {
        const result = this.extractStructData(responseStruct);

        if (result.status === '200 OK' && result.data) {
          return result.data;
        } else if (result.status && result.status.includes('401')) {
          // Handle 401 Unauthorized gracefully - user isn't logged in
          return null;
        } else {
          console.log('❌ GetUserInfo: Failed with status:', result.status);
          throw new Error(`GetUserInfo failed: ${result.status || 'Unknown error'}`);
        }
      }

      throw new Error('Invalid GetUserInfo response structure');
    } catch (error) {
      console.error('GetUserInfo failed:', error);
      throw error;
    }
  }

  // Note: searchMovies() removed in Phase 2 — it was dead code (never called).
  //       Movie autocomplete now goes through `featuresApi.searchByQuery()` /
  //       `featuresApi.byImdbId()` (src/services/api/features.js).
  // Note: checkSubHash*(), buildCheckSubHashXml() removed in Phase 2 — replaced
  //       by REST `POST /api/v1/subtitles/upload/check` (src/services/api/upload.js).
  //       tryUploadSubtitles + buildTryUploadXml stay until Step 7.

  /**
   * Try to upload subtitles using XML-RPC API with PHPSESSID token
   * @param {Object} uploadData - Upload data structure
   * @param {boolean} uploadAsAnonymous - Upload with anonymous token (default: false)
   * @returns {Promise<Object>} - Upload response
   */
  static async tryUploadSubtitles(uploadData, uploadAsAnonymous = false) {
    try {
      console.log('🚀 TryUploadSubtitles: Starting upload attempt...');
      let token;

      if (uploadAsAnonymous) {
        console.log('🔒 TryUploadSubtitles: Anonymous upload enabled - getting anonymous token');
        token = await this.anonymousLogin();
      } else {
        token = this.getAuthToken();
      }

      console.log(
        `🚀 TryUploadSubtitles: Retrieved token - Length: ${token.length}, Value: ${token ? token.substring(0, 8) + '...' : 'EMPTY'}`
      );
      console.log(`🚀 TryUploadSubtitles: Is token empty? ${token === ''}`);
      console.log(`🚀 TryUploadSubtitles: Upload data structure:`, {
        subtitlesCount: uploadData.length,
        firstSubtitle: uploadData[0]
          ? {
              sublanguageid: uploadData[0].sublanguageid,
              moviehash: uploadData[0].moviehash,
              moviebytesize: uploadData[0].moviebytesize,
              hasImdbId: !!uploadData[0].idmovieimdb,
            }
          : 'No subtitles',
      });

      // Convert upload data to XML-RPC format
      const xmlRpcBody = this.buildTryUploadXml(token, uploadData);

      console.log(`🚀 TryUploadSubtitles: XML-RPC body length: ${xmlRpcBody.length} chars`);
      console.log(`🚀 TryUploadSubtitles: XML-RPC includes token: ${xmlRpcBody.includes(token)}`);
      if (token) {
        console.log(
          `🚀 TryUploadSubtitles: Token appears in XML at position: ${xmlRpcBody.indexOf(token)}`
        );
      }

      const response = await delayedFetch(API_ENDPOINTS.OPENSUBTITLES_XMLRPC, {
        method: 'POST',
        headers: getApiHeaders('text/xml'),
        body: xmlRpcBody,
      });

      if (!response.ok) {
        const errorDetails = {
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          url: response.url,
          type: response.type,
          redirected: response.redirected,
        };
        console.error('❌ TryUploadSubtitles: HTTP error response:', errorDetails);
        throw new Error(
          `XML-RPC TryUploadSubtitles failed: ${response.status} ${response.statusText} (${response.url})`
        );
      }

      const xmlText = await response.text();

      const xmlDoc = this.parseXmlRpcResponse(xmlText);

      // Parse response
      const responseStruct = xmlDoc.querySelector('methodResponse param value struct');
      if (responseStruct) {
        const result = this.extractStructData(responseStruct);

        // Check for anonymous upload 401 error
        if (uploadAsAnonymous && result.status === '401 Unauthorized') {
          console.error('❌ TryUploadSubtitles: Anonymous upload not supported by API');
          throw new Error(
            'Anonymous uploads are not supported by the OpenSubtitles API. Please disable "Upload as Anonymous" in settings and try again.'
          );
        }

        return result;
      }

      console.error('❌ TryUploadSubtitles: Invalid response structure');
      console.error('❌ TryUploadSubtitles: Full XML response:', xmlText);
      throw new Error('Invalid TryUploadSubtitles response structure');
    } catch (error) {
      console.error('❌ TryUploadSubtitles: Request failed with error:', error);

      // Enhanced error details for NetworkError
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        console.error('❌ TryUploadSubtitles: This appears to be a network connectivity issue');
        console.error('❌ TryUploadSubtitles: Error details:', {
          name: error.name,
          message: error.message,
          stack: error.stack,
        });
      }

      throw error;
    }
  }

  /**
   * Build XML-RPC body for TryUploadSubtitles
   * @param {string} token - Login token
   * @param {Object} uploadData - Upload data structure
   * @returns {string} - XML-RPC body
   */
  static buildTryUploadXml(token, uploadData) {
    // Always use cd1 (multi-CD subtitles are no longer used)
    const subtitle = uploadData.subtitles[0]; // Take first subtitle

    return `<?xml version="1.0"?>
<methodCall>
  <methodName>TryUploadSubtitles</methodName>
  <params>
    <param><value><string>${token}</string></value></param>
    <param>
      <value>
        <struct>
          <member>
            <name>cd1</name>
            <value>
              <struct>
                <member>
                  <name>subhash</name>
                  <value><string>${subtitle.subhash}</string></value>
                </member>
                <member>
                  <name>subfilename</name>
                  <value><string>${this.escapeXmlContent(subtitle.subfilename)}</string></value>
                </member>
                ${
                  subtitle.moviehash
                    ? `
                <member>
                  <name>moviehash</name>
                  <value><string>${subtitle.moviehash}</string></value>
                </member>`
                    : ''
                }
                ${
                  subtitle.moviebytesize
                    ? `
                <member>
                  <name>moviebytesize</name>
                  <value><string>${subtitle.moviebytesize}</string></value>
                </member>`
                    : ''
                }
                ${
                  subtitle.moviefilename
                    ? `
                <member>
                  <name>moviefilename</name>
                  <value><string>${this.escapeXmlContent(subtitle.moviefilename)}</string></value>
                </member>`
                    : ''
                }
                ${
                  subtitle.idmovieimdb
                    ? `
                <member>
                  <name>idmovieimdb</name>
                  <value><string>${subtitle.idmovieimdb}</string></value>
                </member>`
                    : ''
                }
                ${
                  subtitle.movietimems
                    ? `
                <member>
                  <name>movietimems</name>
                  <value><string>${subtitle.movietimems}</string></value>
                </member>`
                    : ''
                }
                ${
                  subtitle.moviefps
                    ? `
                <member>
                  <name>moviefps</name>
                  <value><string>${subtitle.moviefps}</string></value>
                </member>`
                    : ''
                }
                ${
                  subtitle.movieframes
                    ? `
                <member>
                  <name>movieframes</name>
                  <value><string>${subtitle.movieframes}</string></value>
                </member>`
                    : ''
                }
              </struct>
            </value>
          </member>
        </struct>
      </value>
    </param>
  </params>
</methodCall>`;
  }


  /**
   * Upload subtitles using XML-RPC API (for new uploads when alreadyindb=0)
   * @param {Object} uploadData - Upload data structure with baseinfo and cd1
   * @param {boolean} uploadAsAnonymous - Upload with anonymous token (default: false)
   * @returns {Promise<Object>} - Upload response
   */
  static async uploadSubtitles(uploadData, uploadAsAnonymous = false) {
    try {
      let token;

      if (uploadAsAnonymous) {
        console.log('🔒 UploadSubtitles: Anonymous upload enabled - getting anonymous token');
        token = await this.anonymousLogin();
      } else {
        token = this.getAuthToken();
      }

      // Convert upload data to XML-RPC format
      const xmlRpcBody = this.buildUploadSubtitlesXml(token, uploadData);

      const response = await delayedFetch(API_ENDPOINTS.OPENSUBTITLES_XMLRPC, {
        method: 'POST',
        headers: getApiHeaders('text/xml'),
        body: xmlRpcBody,
      });

      if (!response.ok) {
        const errorDetails = {
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          url: response.url,
          type: response.type,
          redirected: response.redirected,
        };
        console.error('❌ UploadSubtitles: HTTP error response:', errorDetails);
        throw new Error(
          `XML-RPC UploadSubtitles failed: ${response.status} ${response.statusText} (${response.url})`
        );
      }

      const xmlText = await response.text();

      const xmlDoc = this.parseXmlRpcResponse(xmlText);

      // Parse response
      const responseStruct = xmlDoc.querySelector('methodResponse param value struct');
      if (responseStruct) {
        const result = this.extractStructData(responseStruct);

        // Check for anonymous upload 401 error
        if (uploadAsAnonymous && result.status === '401 Unauthorized') {
          console.error('❌ UploadSubtitles: Anonymous upload not supported by API');
          throw new Error(
            'Anonymous uploads are not supported by the OpenSubtitles API. Please disable "Upload as Anonymous" in settings and try again.'
          );
        }

        return result;
      }

      console.error('❌ UploadSubtitles: Invalid response structure');
      console.error('❌ UploadSubtitles: Full XML response:', xmlText);
      throw new Error('Invalid UploadSubtitles response structure');
    } catch (error) {
      console.error('❌ UploadSubtitles: Request failed with error:', error);

      // Enhanced error details for NetworkError
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        console.error('❌ UploadSubtitles: This appears to be a network connectivity issue');
        console.error('❌ UploadSubtitles: Error details:', {
          name: error.name,
          message: error.message,
          stack: error.stack,
        });
      }

      throw error;
    }
  }

  /**
   * Build XML-RPC body for UploadSubtitles
   * @param {string} token - Login token
   * @param {Object} uploadData - Upload data structure
   * @returns {string} - XML-RPC body
   */
  static buildUploadSubtitlesXml(token, uploadData) {
    const baseinfo = uploadData.baseinfo;
    const cd1 = uploadData.cd1;

    return `<?xml version="1.0"?>
<methodCall>
  <methodName>UploadSubtitles</methodName>
  <params>
    <param><value><string>${token}</string></value></param>
    <param>
      <value>
        <struct>
          <member>
            <name>baseinfo</name>
            <value>
              <struct>
                <member>
                  <name>idmovieimdb</name>
                  <value><string>${baseinfo.idmovieimdb}</string></value>
                </member>
                ${
                  baseinfo.moviereleasename
                    ? `
                <member>
                  <name>moviereleasename</name>
                  <value><string>${this.escapeXmlContent(baseinfo.moviereleasename)}</string></value>
                </member>`
                    : ''
                }
                ${
                  baseinfo.sublanguageid
                    ? `
                <member>
                  <name>sublanguageid</name>
                  <value><string>${baseinfo.sublanguageid}</string></value>
                </member>`
                    : ''
                }
                ${
                  baseinfo.movieaka
                    ? `
                <member>
                  <name>movieaka</name>
                  <value><string>${this.escapeXmlContent(baseinfo.movieaka)}</string></value>
                </member>`
                    : ''
                }
                ${
                  baseinfo.subauthorcomment
                    ? `
                <member>
                  <name>subauthorcomment</name>
                  <value><string>${this.escapeXmlContent(baseinfo.subauthorcomment)}</string></value>
                </member>`
                    : ''
                }
                <member>
                  <name>hearingimpaired</name>
                  <value><string>${baseinfo.hearingimpaired || '0'}</string></value>
                </member>
                ${
                  baseinfo.highdefinition !== undefined
                    ? `
                <member>
                  <name>highdefinition</name>
                  <value><string>${baseinfo.highdefinition}</string></value>
                </member>`
                    : ''
                }
                <member>
                  <name>automatictranslation</name>
                  <value><string>${baseinfo.automatictranslation || '0'}</string></value>
                </member>
                ${
                  baseinfo.subtranslator
                    ? `
                <member>
                  <name>subtranslator</name>
                  <value><string>${this.escapeXmlContent(baseinfo.subtranslator)}</string></value>
                </member>`
                    : ''
                }
                <member>
                  <name>foreignpartsonly</name>
                  <value><string>${baseinfo.foreignpartsonly || '0'}</string></value>
                </member>
              </struct>
            </value>
          </member>
          <member>
            <name>cd1</name>
            <value>
              <struct>
                <member>
                  <name>subhash</name>
                  <value><string>${cd1.subhash}</string></value>
                </member>
                <member>
                  <name>subfilename</name>
                  <value><string>${this.escapeXmlContent(cd1.subfilename)}</string></value>
                </member>
                ${
                  cd1.moviehash
                    ? `
                <member>
                  <name>moviehash</name>
                  <value><string>${cd1.moviehash}</string></value>
                </member>`
                    : ''
                }
                ${
                  cd1.moviebytesize
                    ? `
                <member>
                  <name>moviebytesize</name>
                  <value><string>${cd1.moviebytesize}</string></value>
                </member>`
                    : ''
                }
                ${
                  cd1.moviefilename
                    ? `
                <member>
                  <name>moviefilename</name>
                  <value><string>${this.escapeXmlContent(cd1.moviefilename)}</string></value>
                </member>`
                    : ''
                }
                <member>
                  <name>subcontent</name>
                  <value><string>${this.escapeXmlContent(cd1.subcontent)}</string></value>
                </member>
                ${
                  cd1.movietimems
                    ? `
                <member>
                  <name>movietimems</name>
                  <value><string>${cd1.movietimems}</string></value>
                </member>`
                    : ''
                }
                ${
                  cd1.moviefps
                    ? `
                <member>
                  <name>moviefps</name>
                  <value><string>${cd1.moviefps}</string></value>
                </member>`
                    : ''
                }
                ${
                  cd1.movieframes
                    ? `
                <member>
                  <name>movieframes</name>
                  <value><string>${cd1.movieframes}</string></value>
                </member>`
                    : ''
                }
              </struct>
            </value>
          </member>
        </struct>
      </value>
    </param>
  </params>
</methodCall>`;
  }

  /**
   * Escape XML content for safe embedding
   * @param {string} content - Content to escape
   * @returns {string} - Escaped content
   */
  static escapeXmlContent(content) {
    return content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Generic XML-RPC call function
   * @param {string} methodName - The XML-RPC method name
   * @param {Array} params - Array of parameters
   * @returns {Promise<Object>} - Parsed XML-RPC response
   */
  static async xmlrpcCall(methodName, params) {
    try {
      // Build XML-RPC body
      const paramsXml = params
        .map(param => {
          if (typeof param === 'string') {
            return `<param><value><string>${this.escapeXmlContent(param)}</string></value></param>`;
          } else if (typeof param === 'number') {
            return `<param><value><int>${param}</int></value></param>`;
          } else {
            return `<param><value><string>${this.escapeXmlContent(String(param))}</string></value></param>`;
          }
        })
        .join('');

      const xmlRpcBody = `<?xml version="1.0"?>
<methodCall>
  <methodName>${methodName}</methodName>
  <params>
    ${paramsXml}
  </params>
</methodCall>`;

      const headers = getApiHeaders('text/xml');

      const response = await delayedFetch(API_ENDPOINTS.OPENSUBTITLES_XMLRPC, {
        method: 'POST',
        headers,
        body: xmlRpcBody,
      });

      if (!response.ok) {
        console.error(
          `❌ ${methodName}: Request failed with status: ${response.status} ${response.statusText}`
        );
        throw new Error(`XML-RPC ${methodName} failed: ${response.status} ${response.statusText}`);
      }

      const xmlText = await response.text();

      const xmlDoc = this.parseXmlRpcResponse(xmlText);

      // Parse response
      const responseStruct = xmlDoc.querySelector('methodResponse param value struct');
      if (responseStruct) {
        const result = this.extractStructData(responseStruct);
        return result;
      }

      // Handle simple responses (like strings)
      const simpleValue = xmlDoc.querySelector('methodResponse param value string');
      if (simpleValue) {
        return { data: simpleValue.textContent };
      }

      console.error(`❌ ${methodName}: Invalid response structure`);
      throw new Error(`Invalid ${methodName} response structure`);
    } catch (error) {
      console.error(`❌ ${methodName}: Request failed with error:`, error);

      // Enhanced error details for NetworkError
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        console.error(`❌ ${methodName}: This appears to be a network connectivity issue`);
        console.error(`❌ ${methodName}: Error details:`, {
          name: error.name,
          message: error.message,
          stack: error.stack,
        });
      }

      throw error;
    }
  }
}

/**
 * Export the xmlrpcCall function for compatibility
 * @param {string} methodName - The XML-RPC method name
 * @param {Array} params - Array of parameters
 * @returns {Promise<Object>} - Parsed XML-RPC response
 */
export const xmlrpcCall = (methodName, params) => {
  return XmlRpcService.xmlrpcCall(methodName, params);
};
