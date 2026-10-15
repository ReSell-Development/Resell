const toKey = (id) => {
  if (!id) return '';
  if (typeof id === 'string') return id;
  if (id.toString) return id.toString();
  return String(id);
};
module.exports = { toKey };
