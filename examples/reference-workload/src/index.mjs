/** @param {string} name */
export function greet(name) {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new TypeError('A non-empty name is required.');
  }
  return `Hello, ${name.trim()}!`;
}
