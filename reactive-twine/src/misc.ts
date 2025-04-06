/**!
  * This Source Code Form is subject to the terms of the Mozilla Public
  * License, v. 2.0. If a copy of the MPL was not distributed with this
  * file, You can obtain one at https://mozilla.org/MPL/2.0/.
  */

import { baseElementNS } from './constants.ts';

import type { StateAPI, MacroContext } from 'twine-sugarcube';


export function macroIsInDom(errorContext?: MacroContext) : errorContext is MacroContext {
  if (!errorContext) return false;
  return errorContext.output.getRootNode() === window.document;
}

type Store = Record<string, unknown>;
type PseudoPrototype = Record<string, unknown>;
interface IHandler {
  targetPrototype: PseudoPrototype
  errorContext: MacroContext
}
export const storeEnrichmentHandler = {
  get(this: IHandler, target: Store, propName: string, recv: unknown) {
    if (Object.prototype.hasOwnProperty.call(this.targetPrototype, propName)) {
      return Reflect.get(this.targetPrototype, propName, target)
    } else {
      return Reflect.get(target, propName, recv);
    }
  },
  set(this: IHandler, target: Store, propName: string, value: unknown) {
    if (!Object.prototype.hasOwnProperty.call(this.targetPrototype, propName)) {
      return Reflect.set(target, propName, value);
    }

    const descriptor = Reflect.getOwnPropertyDescriptor(this.targetPrototype, propName);
    if (descriptor?.set) {
      return descriptor.set.call(target, value);
    }

    const msg = `Attempting to set a computed attribute: "${propName}"`;
    console.error(msg);
    if (this.errorContext && macroIsInDom(this.errorContext)) {
      this.errorContext.error(msg);
    } else {
      throw new Error(msg);
    }
  },
};

export function getStorePseudoPrototype(storeName: string) {
  const elementNS = `${baseElementNS}/event-bus`;

  if (!getStorePseudoPrototype.cache.has(storeName)) {
    const passage = Story.get(storeName);

    const root = document.createElementNS(
      elementNS,
      'store-pseudo-prototype-receiver'
    );
    new Wikifier(root as HTMLElement, passage.text);
    const elem = root.getElementsByTagNameNS(elementNS, 'store-pseudo-prototype');
    const prototypeGetter = $(elem).data('getStorePseudoPrototype');
    const result = prototypeGetter ? prototypeGetter() : {};

    getStorePseudoPrototype.cache.set(storeName, result);
  }
  return getStorePseudoPrototype.cache.get(storeName);
}
getStorePseudoPrototype.cache = new Map();


export function checkForWikiError(output: Node | HTMLElement) {
  // reference from
  // https://github.com/tmedwards/sugarcube-2/blob/0d3becc5f6360c362499859ea9d2e3ed7bec09a5/src/markup/wikifier.js#L284C1-L288C5
  // https://github.com/tmedwards/sugarcube-2/blob/0d3becc5f6360c362499859ea9d2e3ed7bec09a5/src/lib/alert.js#L20
  const errors = (output as HTMLElement).querySelector('.error');

  if (errors !== null) {
    const errorPrologRE = /^(?:(?:uncaught\s+(?:exception:\s+)?)?\w*(?:error|exception|_err):\s+)+/i;
    throw new Error((errors.textContent || '').replace(errorPrologRE, ''));
  }
}

export function injectVariables(
  State: StateAPI,
  obj: Record<string, unknown>
) {
  const _State = State as StateAPI & { variables: Record<string, unknown> };
  const oldState = new Map();
  for (const attr in obj) {
    if (attr in State.variables) {
      oldState.set(attr, _State.variables[attr]);
    }
    _State.variables[attr] = obj[attr];
  }

  return function restore() {
    for (const attr in obj) {
      if (oldState.has(attr)) {
        _State.variables[attr] = oldState.get(attr);
      } else {
        delete _State.variables[attr];
      }
    }
  }
}
export function createShadowStore(
  State: StateAPI,
  obj: Record<string, unknown>
) {
  const oldState = new Map();
  for (const attr in obj) {
    if (attr in State.temporary) {
      oldState.set(attr, State.temporary[attr]);
    }
    State.temporary[attr] = obj[attr];
  }

  return function restore() {
    for (const attr in obj) {
      if (oldState.has(attr)) {
        State.temporary[attr] = oldState.get(attr);
      } else {
        delete State.temporary[attr];
      }
    }
  }
}
export function createAllShadowStore(
  State: StateAPI,
  context: Record<string, unknown>
) {
  const storage = new Map();
  for (const attr in State.temporary) {
    storage.set(attr, State.temporary[attr]);
    delete State.temporary[attr];
  }
  for (const attr in context) {
    State.temporary[attr] = context[attr];
  }

  return function restore() {
    for (const attr in State.temporary) {
      delete State.temporary[attr];
    }
    for (const attr in storage) {
      State.temporary[attr] = storage.get(attr);
    }
  }
}


