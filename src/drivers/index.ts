import type { AnyDriver } from '../core/driver.ts';
import { ddpaiDriver } from './ddpai/index.ts';
import { simulatorDriver } from './simulator.ts';

/**
 * Drivers shipped with the server. A new device type is one module exporting a `defineDriver(...)`
 * plus one line here. See CONTRIBUTING.md → "Adding a driver".
 */
export const BUILTIN_DRIVERS: readonly AnyDriver[] = [ddpaiDriver, simulatorDriver];
