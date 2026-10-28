function buildTierField(names, label = `Tiers (${names.length})`) {
  if (!names.length) return null;
  const included = [];
  for (const [index, name] of names.entries()) {
    const remaining = names.length - index - 1;
    const suffix = remaining ? `, …and ${remaining} more` : '';
    const next = [...included, name].join(', ');
    if (next.length + suffix.length > 1024) {
      return { name: label, value: `${included.join(', ')}, …and ${names.length - index} more` };
    }
    included.push(name);
  }
  return { name: label, value: included.join(', ') };
}

module.exports = { buildTierField };
