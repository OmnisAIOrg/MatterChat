#!/bin/bash
# MatterChat toolchain installer — idempotent-ish, continue-on-error, prints a summary.
set -u
export NONINTERACTIVE=1
export HOMEBREW_NO_AUTO_UPDATE=1
BREW=/usr/local/bin/brew
NODE_VERSION=22.22.3
declare -a RESULTS

step() { echo; echo "============================================================"; echo ">>> $1"; echo "============================================================"; }
record() { RESULTS+=("$1"); }

# 1. nvm + Node 22.22.3
step "nvm + Node ${NODE_VERSION}"
export NVM_DIR="$HOME/.nvm"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
fi
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm install "$NODE_VERSION" && nvm alias default "$NODE_VERSION" && nvm use "$NODE_VERSION"
NODE_BIN="$NVM_DIR/versions/node/v${NODE_VERSION}/bin"
export PATH="$NODE_BIN:$PATH"
if "$NODE_BIN/node" -v | grep -q "v${NODE_VERSION}"; then record "node ${NODE_VERSION}: OK ($($NODE_BIN/node -v))"; else record "node ${NODE_VERSION}: FAIL"; fi

# 2. corepack -> yarn 4
step "corepack enable -> yarn"
corepack enable
corepack prepare yarn@4.12.0 --activate 2>&1 | tail -2
if command -v yarn >/dev/null 2>&1; then record "yarn: OK ($(yarn -v 2>&1))"; elif [ -x "$NODE_BIN/yarn" ]; then record "yarn: OK ($($NODE_BIN/yarn -v 2>&1))"; else record "yarn: FAIL (corepack shim)"; fi

# 3. Deno
step "brew install deno"
"$BREW" install deno 2>&1 | tail -3
if "$BREW" list deno >/dev/null 2>&1; then record "deno: OK ($(/usr/local/bin/deno --version 2>&1 | head -1))"; else record "deno: FAIL"; fi

# 4. mongosh
step "brew install mongosh"
"$BREW" install mongosh 2>&1 | tail -3
if command -v mongosh >/dev/null 2>&1 || "$BREW" list mongosh >/dev/null 2>&1; then record "mongosh: OK"; else record "mongosh: FAIL"; fi

# 5. mongodb-community (server)
step "brew tap mongodb/brew + install mongodb-community"
"$BREW" tap mongodb/brew 2>&1 | tail -2
"$BREW" install mongodb-community 2>&1 | tail -4
if "$BREW" list mongodb-community >/dev/null 2>&1; then record "mongodb-community: OK ($(/usr/local/bin/mongod --version 2>&1 | head -1))"; else record "mongodb-community: FAIL"; fi

# 6. Meteor 3.4.1
step "Meteor 3.4.1 installer"
if [ ! -x "$HOME/.meteor/meteor" ]; then
  curl -fsSL "https://install.meteor.com/?release=3.4.1" | sh 2>&1 | tail -6
fi
export PATH="$HOME/.meteor:$PATH"
if "$HOME/.meteor/meteor" --version >/dev/null 2>&1; then record "meteor: OK ($($HOME/.meteor/meteor --version 2>&1 | head -1))"; else record "meteor: INSTALLED? ($(ls -la $HOME/.meteor/meteor 2>&1 | head -1))"; fi

# Summary
step "SUMMARY"
printf '%s\n' "${RESULTS[@]}"
echo "TOOLCHAIN_INSTALL_DONE"
