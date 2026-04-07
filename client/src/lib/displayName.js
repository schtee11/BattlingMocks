// Strip the "-NNNN" discriminator suffix we append when a Discord
// username collides with an existing display_name. The underlying
// DB value keeps the suffix (needed for uniqueness); we only hide
// it in the UI.
export function prettyName(name) {
  if (!name) return name;
  return name.replace(/-\d{2,5}$/, '');
}
