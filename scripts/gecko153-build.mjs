import { readFileSync } from 'node:fs';

/** d3-color creates its own prototypes; define own properties so frozen
 * Object.prototype members cannot block shadowing constructor/toString. */
export function gecko153CompatibilityPlugin() {
  return {
    name: 'd3-color-frozen-builtins',
    setup(bundler) {
      bundler.onLoad({ filter: /d3-color[\\/]src[\\/]define\.js$/ }, args => {
        let contents = readFileSync(args.path, 'utf8');
        const constructor = 'prototype.constructor = constructor;';
        const extend = 'for (var key in definition) prototype[key] = definition[key];';
        if (contents.split(constructor).length !== 2 || contents.split(extend).length !== 2) {
          throw new Error('d3-color prototype factory changed; re-audit the Gecko 153 compatibility transform');
        }
        contents = contents.replace(constructor,
          'Object.defineProperty(prototype, "constructor", {value: constructor, writable: true, enumerable: true, configurable: true});');
        contents = contents.replace(extend,
          'for (var key in definition) Object.defineProperty(prototype, key, {value: definition[key], writable: true, enumerable: true, configurable: true});');
        return { contents, loader: 'js' };
      });
    }
  };
}
