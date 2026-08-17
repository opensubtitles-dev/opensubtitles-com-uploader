import React, { useReducer } from 'react';
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
 * every module then re-resolves the backend from scratch. If the persist
 * fails (storage disabled/quota — see setActiveEnvironment), no reload
 * happens, but the browser has already changed the <select>'s displayed
 * value to whatever the user clicked. `retrigger` below forces a re-render
 * so the value prop (freshly read from getActiveEnvironmentId()) is
 * re-applied to the DOM, snapping the control back to the real active
 * environment. It has to be a distinct piece of state — re-setting activeId
 * to the same string it already holds would be a no-op update that React
 * bails out of without re-rendering, leaving the stale DOM value in place.
 */
export default function EnvironmentSwitch() {
  const [, retrigger] = useReducer(tick => tick + 1, 0);

  if (!SWITCH_ENABLED) return null;

  const options = listSelectableEnvironments();
  if (options.length < 2) return null;

  const activeId = getActiveEnvironmentId();
  const isDev = activeId === 'dev';

  const handleChange = event => {
    const switched = setActiveEnvironment(event.target.value);
    if (!switched) retrigger();
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
