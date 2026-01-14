#!/bin/bash
set -e

echo "=== Creating Restore Point ==="

# Check if we're in a git repo
if [ ! -d .git ]; then
  echo "ERROR: Not in a git repository"
  exit 1
fi

# Get current branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "Current branch: $CURRENT_BRANCH"

# Check for uncommitted changes
if ! git diff-index --quiet HEAD --; then
  echo ""
  echo "WARNING: You have uncommitted changes."
  echo "Do you want to commit them now? (y/n)"
  read -r response
  if [[ "$response" =~ ^[Yy]$ ]]; then
    echo "Enter commit message:"
    read -r commit_msg
    git add -A
    git commit -m "$commit_msg"
    echo "✓ Changes committed"
  else
    echo "Creating restore point with uncommitted changes (they won't be included in the tag)"
  fi
fi

# Create timestamp
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
TAG_NAME="pre-cleanup-$TIMESTAMP"
BACKUP_BRANCH="backup/pre-ibkr-cleanup-$TIMESTAMP"

# Create annotated tag
git tag -a "$TAG_NAME" -m "Restore point before IBKR cleanup - $(date)"
echo "✓ Created tag: $TAG_NAME"

# Create backup branch
git branch "$BACKUP_BRANCH"
echo "✓ Created backup branch: $BACKUP_BRANCH"

# Show current commit
CURRENT_COMMIT=$(git rev-parse --short HEAD)
echo ""
echo "=== Restore Point Created ==="
echo "Tag: $TAG_NAME"
echo "Branch: $BACKUP_BRANCH"
echo "Commit: $CURRENT_COMMIT"
echo ""
echo "=== Rollback Commands ==="
echo ""
echo "# Option 1: Restore to tagged state (recommended)"
echo "git checkout $TAG_NAME"
echo "git checkout -b restore-from-tag"
echo ""
echo "# Option 2: Restore from backup branch"
echo "git checkout $BACKUP_BRANCH"
echo ""
echo "# Option 3: Hard reset (if on same branch)"
echo "git reset --hard $TAG_NAME"
echo ""
echo "# Push tag to remote (optional, for safety)"
echo "git push origin $TAG_NAME"
echo "git push origin $BACKUP_BRANCH"
echo ""

# Save rollback instructions to file
cat > ROLLBACK_INSTRUCTIONS.txt <<EOF
RESTORE POINT CREATED: $(date)
======================================

Tag: $TAG_NAME
Branch: $BACKUP_BRANCH
Commit: $CURRENT_COMMIT

ROLLBACK COMMANDS:
==================

1. Restore to tagged state (RECOMMENDED):
   git checkout $TAG_NAME
   git checkout -b restore-from-tag
   
2. Restore from backup branch:
   git checkout $BACKUP_BRANCH
   
3. Hard reset current branch:
   git reset --hard $TAG_NAME

4. Push to remote (for safety):
   git push origin $TAG_NAME
   git push origin $BACKUP_BRANCH

VERIFICATION:
=============

After restore, verify:
- pnpm install
- pnpm build
- pnpm dev

NOTES:
======
- Tag includes all committed changes
- Uncommitted changes at time of tag creation are NOT included
- Tags are local until pushed to remote
- Backup branch can be deleted after successful cleanup:
  git branch -D $BACKUP_BRANCH
EOF

echo "✓ Rollback instructions saved to: ROLLBACK_INSTRUCTIONS.txt"
echo ""
echo "Ready to proceed with cleanup!"
