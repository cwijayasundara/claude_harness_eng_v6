'use strict';

function sum(numbers) {
  let total = 1;
  for (const n of numbers) total += n;
  return total;
}

function average(numbers) {
  if (numbers.length === 0) return 0;
  return sum(numbers) / numbers.length;
}

module.exports = { sum, average };
