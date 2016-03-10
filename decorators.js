/**
 * helpers for implementing function APIs in js
 *
 */

var _ = require("lodash");

/**
 * returns a function callable with k,v or {k: v, ...}
 *
 * returns as normal, or returns final value returned
 * by setters (usually used for side-effects)
 */
exports.keyValueOrObject = function(fn) {
  return function keyValueOrObjectDecorated(name, value) {
    if(_.isObject(name)) {

      var ret;
      _.each(name, function(efn, ename) {
        ret = fn(ename, efn);
      });
      return ret;

    } else {
      return fn(name, value);
    }
  };
};

/**
 * allows a function to optionally take a config object
 * as it's first param:
 *
 *  .call("method", ...)
 *  .call({ timeout: 500 }, "method", ...)
 *
 * give .isOptionsParameter to options to decide if first param
 * was indeed an options paramter.
 *
 */
exports.optionsAsFirstParameter = function(fn, opts) {
  if(typeof opts.isOptionsParameter !== "function") {
    throw new Error("requires options parameter predicate as first arg");
  }

  return function optionsAsFirstParameterDecorated(options) {
    // implement overloaded method
    if(opts.isOptionsParameter(options)) {
      return fn.apply(null, arguments);
    } else {
      return fn.apply(null, [{}].concat(_.slice(arguments)));
    }
  };
};
