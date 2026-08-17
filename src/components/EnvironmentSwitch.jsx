import React from 'react';
import { Server } from 'lucide-react';
import {
  SWITCH_ENABLED,
  listSelectableEnvironments,
  getActiveEnvironmentId,
  setActiveEnvironment,
} from '../config/environments.js';

/**
 * Backend environment switch. Renders nothing unless the build was made with
 * VITE_ENV_SWITCH=true, so public builds carry no dead chrome.
 *
 * Changing the environment persists the choice and reloads the window —
 * every module then re-resolves the backend from scratch.
 */
export default function EnvironmentSwitch() {
  if (!SWITCH_ENABLED) return null;

  const options = listSelectableEnvironments();
  if (options.length < 2) return null;

  const activeId = getActiveEnvironmentId();
  const isDev = activeId === 'dev';

  const handleChange = event => {
    setActiveEnvironment(event.target.value);
  };

  return (
    <div className="flex items-center gap-2" title="Which backend receives uploads">
      <Server className={`size-4 ${isDev ? 'text-warning' : 'text-success'}`} aria-hidden="true" />
      <select
        className={`select select-bordered select-sm ${isDev ? 'select-warning' : ''}`}
        value={activeId}
        onChange={handleChange}
        aria-label="Backend environment"
      >
        {options.map(env => (
          <option key={env.id} value={env.id}>
            {env.label}
          </option>
        ))}
      </select>
      {isDev && <span className="badge badge-warning badge-sm">DEV</span>}
    </div>
  );
}
