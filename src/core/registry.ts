import { ConfigError } from '../lib/options.ts';
import type { AnyDriver } from './driver.ts';

const ID_PATTERN = /^[a-z][a-z0-9-]*$/;

/** Known drivers by id. */
export class DriverRegistry {
  private readonly drivers = new Map<string, AnyDriver>();

  constructor(drivers: Iterable<AnyDriver> = []) {
    for (const d of drivers) this.register(d);
  }

  register(driver: AnyDriver): this {
    if (!ID_PATTERN.test(driver.id)) throw new Error(`invalid driver id "${driver.id}"`);
    if (this.drivers.has(driver.id)) throw new Error(`driver "${driver.id}" is registered twice`);
    this.drivers.set(driver.id, driver);
    return this;
  }

  get(id: string): AnyDriver {
    const driver = this.drivers.get(id);
    if (!driver) {
      throw new ConfigError(`unknown driver "${id}". Available: ${[...this.drivers.keys()].join(', ')}`);
    }
    return driver;
  }

  list(): AnyDriver[] {
    return [...this.drivers.values()];
  }
}
