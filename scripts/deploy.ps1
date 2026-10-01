# npm run deploy — GitHub first, then Netlify. Stops at the first failure.
#
# Until Sep 2026 the deploy ran a bare `git push` from a side branch that had
# no GitHub branch behind it. The push failed every time, the script carried
# on, and Netlify got two weeks of work that GitHub never saw. So now:
#   1. it only deploys from `main`;
#   2. it pulls GitHub's changes first (edits made on GitHub or by someone
#      else are merged in, never overwritten);
#   3. if committing, pulling or pushing fails, NOTHING is deployed;
#   4. the live site is only built from code that is already on GitHub.
#
# `npm run deploy` skips the deploy when the current commit is the one that
# was last deployed (.last-deploy, gitignored). `npm run deploy -- -Force`
# deploys anyway.

param([switch]$Force)

$ErrorActionPreference = 'Continue'
Set-Location (Split-Path $PSScriptRoot -Parent)

function Stop-Deploy($msg) {
  Write-Host ""
  Write-Host "DEPLOY STOPPED: $msg" -ForegroundColor Red
  Write-Host "Nothing was deployed to the live site." -ForegroundColor Red
  exit 1
}

# 1. Right branch?
$branch = (git rev-parse --abbrev-ref HEAD).Trim()
if ($LASTEXITCODE -ne 0) { Stop-Deploy "this folder is not a git repository." }
if ($branch -ne 'main') {
  Stop-Deploy "you are on branch '$branch'. Deploys must come from 'main' so GitHub and the live site stay identical. Switch with: git checkout main"
}

# 2. Commit local changes.
if (git status --porcelain) {
  git add .
  if ($LASTEXITCODE -ne 0) { Stop-Deploy "git add failed." }
  git commit -m "website updates"
  if ($LASTEXITCODE -ne 0) { Stop-Deploy "git commit failed." }
}

# 3. Bring in anything new on GitHub, on top of which our commits are replayed.
git pull --rebase origin main
if ($LASTEXITCODE -ne 0) {
  git rebase --abort 2>$null
  Stop-Deploy "your changes clash with changes on GitHub. Your work is committed locally and safe; ask for help merging, then run npm run deploy again."
}

# 4. Push. If GitHub doesn't have the code, the live site doesn't get it either.
git push origin main
if ($LASTEXITCODE -ne 0) { Stop-Deploy "pushing to GitHub failed (check your internet / GitHub login)." }

$head = (git rev-parse HEAD).Trim()
$last = if (Test-Path .last-deploy) { (Get-Content .last-deploy -Raw).Trim() } else { "" }
if (-not $Force -and $head -eq $last) {
  Write-Output "No changes since the last deploy. Production deploy skipped. (npm run deploy -- -Force deploys anyway.)"
  exit 0
}

# 5. Build. resources/_gen is kept on purpose: it caches the resized gallery
#    images, which would otherwise all be downloaded and rebuilt every time.
if (Test-Path .\public) { Remove-Item -Recurse -Force .\public }
if (Test-Path .\.hugo_build.lock) { Remove-Item -Force .\.hugo_build.lock }
npm run build
if ($LASTEXITCODE -ne 0) { Stop-Deploy "the site build failed (GitHub is updated; the live site is unchanged)." }

# 6. Deploy.
netlify deploy --prod --dir=public
if ($LASTEXITCODE -ne 0) { Stop-Deploy "the Netlify upload failed (GitHub is updated; run npm run deploy again to retry)." }
Set-Content -Path .last-deploy -Value $head -Encoding ascii

Write-Host ""
Write-Host "Deployed $($head.Substring(0,7)) to Netlify; GitHub main is the same commit." -ForegroundColor Green

# 7. Tell search engines about changed URLs (never fails the deploy).
npm run notify-search-engines
exit 0
