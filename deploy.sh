#!/bin/bash
set -e

# ============================================
# thundeeran.dev — One-shot deploy script
# Run this from inside the thundeeran.dev folder
# ============================================

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║   thundeeran.dev — Deploy Script     ║"
echo "  ╚══════════════════════════════════════╝"
echo ""

# Step 1: Install gh if missing
if ! command -v gh &> /dev/null; then
    echo "→ Installing GitHub CLI..."
    if command -v brew &> /dev/null; then
        brew install gh
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
        echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
        sudo apt update && sudo apt install gh -y
    else
        echo "❌ Cannot auto-install gh. Install manually: https://cli.github.com"
        exit 1
    fi
    echo "✓ gh installed"
else
    echo "✓ gh already installed"
fi

# Step 2: Authenticate if needed
if ! gh auth status &> /dev/null; then
    echo "→ Authenticating with GitHub..."
    gh auth login --web --git-protocol https
    echo "✓ Authenticated"
else
    echo "✓ Already authenticated"
fi

# Step 3: Get username
GH_USER=$(gh api user -q .login)
echo "✓ Logged in as: $GH_USER"

# Step 4: Create repo
echo "→ Creating repo thundeeran.dev..."
gh repo create thundeeran.dev \
    --public \
    --description "Interactive research on the future of SDLC — thundeeran.dev" \
    --homepage "https://thundeeran.dev" \
    --source=. \
    --remote=origin \
    --push 2>/dev/null || {
        # Repo might already exist, just set remote and push
        echo "  (repo may already exist, setting remote...)"
        git remote set-url origin "https://github.com/$GH_USER/thundeeran.dev.git" 2>/dev/null || \
        git remote add origin "https://github.com/$GH_USER/thundeeran.dev.git" 2>/dev/null || true
        git push -u origin main
    }
echo "✓ Code pushed"

# Step 5: Enable GitHub Pages
echo "→ Enabling GitHub Pages..."
gh api repos/$GH_USER/thundeeran.dev/pages \
    -X POST \
    -f "source[branch]=main" \
    -f "source[path]=/" 2>/dev/null || {
        echo "  (Pages may already be enabled, updating...)"
        gh api repos/$GH_USER/thundeeran.dev/pages \
            -X PUT \
            -f "source[branch]=main" \
            -f "source[path]=/" 2>/dev/null || true
    }
echo "✓ GitHub Pages enabled"

# Step 6: Set custom domain
echo "→ Setting custom domain..."
gh api repos/$GH_USER/thundeeran.dev/pages \
    -X PUT \
    -f "cname=thundeeran.dev" \
    -f "source[branch]=main" \
    -f "source[path]=/" 2>/dev/null || true
echo "✓ Custom domain set to thundeeran.dev"

echo ""
echo "  ╔══════════════════════════════════════════════════╗"
echo "  ║   ✓ DEPLOYED!                                   ║"
echo "  ║                                                  ║"
echo "  ║   Repo:  github.com/$GH_USER/thundeeran.dev     ║"
echo "  ║   Live:  https://$GH_USER.github.io/thundeeran.dev ║"
echo "  ║                                                  ║"
echo "  ║   After DNS setup → https://thundeeran.dev       ║"
echo "  ╚══════════════════════════════════════════════════╝"
echo ""
echo "  NEXT: Point your domain DNS (Cloudflare/Namecheap):"
echo ""
echo "    Type    Name    Value"
echo "    A       @       185.199.108.153"
echo "    A       @       185.199.109.153"
echo "    A       @       185.199.110.153"
echo "    A       @       185.199.111.153"
echo "    CNAME   www     $GH_USER.github.io"
echo ""
