#!/usr/bin/env bash
set -euo pipefail

# install.sh — install the opencode-tokenmeter-tui update helper for users who
# do NOT have this repository cloned.
#
# Usage (official, from the repo):
#   curl -fsSL https://raw.githubusercontent.com/jonasotoaguilar/opencode-tokenmeter/main/scripts/install.sh | bash
#
# What it does:
#   1. Downloads scripts/update-plugin from this repository into
#      ~/.local/share/opencode-tokenmeter/ (overridable via OPENCODE_TOKENMETER_UPDATE_DIR).
#   2. Writes a minimal package.json next to it so the helper can identify the
#      package it manages (opencode-tokenmeter-tui).
#   3. Installs a launcher at ~/.local/bin/opencode-tokenmeter-update
#      (overridable via OPENCODE_TOKENMETER_UPDATE_BIN) that calls the helper.
#
# The helper only ever updates opencode-tokenmeter-tui through the official
# `opencode plugin <name>@<version> --force` command; it never touches other
# plugins and needs no npm install (it is plain bash + node).
#
# After install:
#   opencode-tokenmeter-update --check    # report if the plugin is outdated
#   opencode-tokenmeter-update            # update it via the official command
#
# Why curl|bash and not `npm install -g`: the package pulls runtime deps
# (@opentui/solid, solid-js) whose transitive install scripts are blocked by
# npm's strict-allow-scripts security default; the helper itself needs none of
# them. This installer ships only the helper.

# Override points for packagers/advanced users (must be set BEFORE piping).
: "${OPENCODE_TOKENMETER_UPDATE_DIR:=$HOME/.local/share/opencode-tokenmeter}"
: "${OPENCODE_TOKENMETER_UPDATE_BIN:=$HOME/.local/bin/opencode-tokenmeter-update}"

# Base of the raw file source. The official URL points at the repo default
# branch; packagers may override to test a fork or a pinned commit.
: "${OPENCODE_TOKENMETER_RAW:=https://raw.githubusercontent.com/jonasotoaguilar/opencode-tokenmeter/main}"

PACKAGE="opencode-tokenmeter-tui"
HELPER_SOURCE="$OPENCODE_TOKENMETER_RAW/scripts/update-plugin"

echo "Installing $PACKAGE update helper..."
mkdir -p "$OPENCODE_TOKENMETER_UPDATE_DIR" "$(dirname "$OPENCODE_TOKENMETER_UPDATE_BIN")"

curl -fsSL "$HELPER_SOURCE" -o "$OPENCODE_TOKENMETER_UPDATE_DIR/update-plugin"
chmod +x "$OPENCODE_TOKENMETER_UPDATE_DIR/update-plugin"

# Minimal manifest so the helper can resolve its own package name without
# needing the repository checkout.
node -e "require('fs').writeFileSync(process.argv[1], JSON.stringify({ name: process.argv[2] }, null, 2) + '\n')" \
  "$OPENCODE_TOKENMETER_UPDATE_DIR/package.json" "$PACKAGE"

cat > "$OPENCODE_TOKENMETER_UPDATE_BIN" <<EOF
#!/usr/bin/env bash
exec "$OPENCODE_TOKENMETER_UPDATE_DIR/update-plugin" --package "$PACKAGE" "\$@"
EOF
chmod +x "$OPENCODE_TOKENMETER_UPDATE_BIN"

echo "Installed: $OPENCODE_TOKENMETER_UPDATE_BIN"
echo
echo "Usage:"
echo "  $OPENCODE_TOKENMETER_UPDATE_BIN --check    # report if outdated (exit 2 when an update exists)"
echo "  $OPENCODE_TOKENMETER_UPDATE_BIN            # update via the official opencode command"
echo "  $OPENCODE_TOKENMETER_UPDATE_BIN --dry-run  # show the command without running it"
