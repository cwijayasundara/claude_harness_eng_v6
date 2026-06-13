'use strict';

// LEGACY - kept for reference, do not delete without checking with the team
// TODO: someone should really clean this up someday
function oldSum(arr) {
  var s = 0;
  for (var i = 0; i < arr.length; i++) {
    s = s + arr[i];
  }
  return s;
}

// var UNUSED_RATE = 0.15;
// function applyRate(x) { return x * UNUSED_RATE; }

module.exports = { oldSum };
