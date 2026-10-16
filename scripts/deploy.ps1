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
#
# Two ways the live site gets built (Oct 2026, so the site can be deployed
# from the cloud, without this laptop):
#   - Netlify builds from GitHub (its builds are active): every push to main
#     IS the deploy. This script then builds and uploads nothing, which would
#     be a second deploy of the same commit (Netlify credits, twice); it
#     waits for Netlify's deploy of the pushed commit instead.
#   - Netlify's builds are stopped: this laptop builds and uploads, as before.

param([switch]$Force)

$ErrorActionPreference = 'Continue'
Set-Location (Split-Path $PSScriptRoot -Parent)
$SiteId = 'louisandrada.netlify.app'

function Stop-Deploy($msg) {
  Write-Host ""
  Write-Host "DEPLOY STOPPED: $msg" -ForegroundColor Red
  Write-Host "Nothing was deployed to the live site." -ForegroundColor Red
  exit 1
}

function Netlify-Api($method, $data) {
  $json = ($data | ConvertTo-Json -Compress).Replace('"', '\"')
  $out = netlify api $method --data $json 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $out) { return $null }
  try { return ($out | Out-String) | ConvertFrom-Json } catch { return $null }
}

# 1. Right branch?
$branch = (git rev-parse --abbrev-ref HEAD).Trim()
if ($LASTEXITCODE -ne 0) { Stop-Deploy "this folder is not a git repository." }
if ($branch -ne 'main') {
  Stop-Deploy "you are on branch '$branch'. Deploys must come from 'main' so GitHub and the live site stay identical. Switch with: git checkout main"
}

# Who builds? Ask Netlify; if it can't be asked, deploy nothing (guessing wrong
# would either deploy twice or not at all).
$site = Netlify-Api 'getSite' @{ site_id = $SiteId }
if (-not $site) { Stop-Deploy "couldn't ask Netlify how the site is built (check your internet / netlify login)." }
$netlifyBuilds = -not $site.build_settings.stop_builds

# 2. Commit local changes. When Netlify builds, compile the CSS first, so one
#    push carries it (a second "compiled CSS" push would be a second deploy).
if ($netlifyBuilds) {
  npm run css
  if ($LASTEXITCODE -ne 0) { Stop-Deploy "compiling the CSS failed." }
}
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

# 5-6, when Netlify builds from GitHub: the push above started its deploy (or,
# with -Force and nothing new to push, ask for one). Wait for it.
if ($netlifyBuilds) {
  $short = $head.Substring(0, 7)
  if ($head -eq $last) {
    if (-not (Netlify-Api 'createSiteBuild' @{ site_id = $SiteId })) { Stop-Deploy "couldn't ask Netlify to build again." }
  }
  Write-Output "Netlify builds from GitHub: waiting for its deploy of $short (a few minutes)..."
  $state = 'not started'
  $deadline = (Get-Date).AddMinutes(20)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 15
    $deploys = Netlify-Api 'listSiteDeploys' @{ site_id = $SiteId; per_page = 10 }
    $d = @($deploys) | Where-Object { $_.commit_ref -eq $head -and $_.context -eq 'production' } | Select-Object -First 1
    if ($d) { $state = $d.state }
    if ($state -eq 'ready' -or $state -eq 'error') { break }
  }
  if ($state -ne 'ready') {
    Write-Host ""
    Write-Host "DEPLOY NOT CONFIRMED: Netlify's deploy of $short is '$state'. GitHub has the commit; see app.netlify.com -> Deploys." -ForegroundColor Red
    exit 1
  }
  Set-Content -Path .last-deploy -Value $head -Encoding ascii
  Write-Host ""
  Write-Host "Deployed ${short}: Netlify built it from GitHub main." -ForegroundColor Green
  # 7. Tell search engines about changed URLs (never fails the deploy), from the live sitemap.
  New-Item -ItemType Directory -Force .\public | Out-Null
  try { Invoke-WebRequest -UseBasicParsing 'https://andrada.one/sitemap.xml' -OutFile .\public\sitemap.xml } catch {}
  if (Test-Path .\public\sitemap.xml) { npm run notify-search-engines }
  exit 0
}

# 5. Build. resources/_gen is kept on purpose: it caches the resized gallery
#    images, which would otherwise all be downloaded and rebuilt every time.
if (Test-Path .\public) { Remove-Item -Recurse -Force .\public }
if (Test-Path .\.hugo_build.lock) { Remove-Item -Force .\.hugo_build.lock }
npm run build
if ($LASTEXITCODE -ne 0) { Stop-Deploy "the site build failed (GitHub is updated; the live site is unchanged)." }

# The build regenerates static/css/output.css. If that changed it, GitHub must
# get the new file too, or it would lag one deploy behind the live site.
if (git status --porcelain) {
  git add .
  git commit -m "compiled CSS"
  if ($LASTEXITCODE -ne 0) { Stop-Deploy "committing the rebuilt CSS failed." }
  git push origin main
  if ($LASTEXITCODE -ne 0) { Stop-Deploy "pushing the rebuilt CSS to GitHub failed." }
  $head = (git rev-parse HEAD).Trim()
}

# 6. Deploy.
netlify deploy --prod --dir=public
if ($LASTEXITCODE -ne 0) { Stop-Deploy "the Netlify upload failed (GitHub is updated; run npm run deploy again to retry)." }
Set-Content -Path .last-deploy -Value $head -Encoding ascii

Write-Host ""
Write-Host "Deployed $($head.Substring(0,7)) to Netlify; GitHub main is the same commit." -ForegroundColor Green

# 7. Tell search engines about changed URLs (never fails the deploy).
npm run notify-search-engines
exit 0
