"use strict";

exports.runEnsuringPromise = function runEnsuringPromise(Promise, fn, params) {
  try {
    var result = fn.apply(null, params);
  } catch(e) {
    return Promise.reject(e);
  }

  return result && result.then ? result : Promise.resolve(result);
};
