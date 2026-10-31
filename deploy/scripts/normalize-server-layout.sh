#!/usr/bin/env bash
set -euo pipefail

stamp="$(date +%Y%m%d%H%M%S)"
backup_root="/data/apps/_migration-backups/${stamp}"
install -d -m 700 "${backup_root}/nginx" "${backup_root}/systemd" "${backup_root}/retired"

cp -a /etc/nginx/sites-available /etc/nginx/sites-enabled /etc/nginx/conf.d "${backup_root}/nginx/"
for unit in \
  ai-family-health-backend.service \
  ai-family-health-ocr.service \
  ai-leadgen-backend.service \
  ai-leadgen-frontend.service \
  ai-leadgen-lead-worker.service \
  ai-leadgen-wechat-event-worker.service \
  gooyoit-portal.service \
  healthy-meals-plan.service \
  passport-login.service \
  passport-admin.service \
  platform-api.service \
  platform-web.service \
  platform-worker.service; do
  if [[ -f "/etc/systemd/system/${unit}" ]]; then
    cp -a "/etc/systemd/system/${unit}" "${backup_root}/systemd/"
  fi
done

# Stop every process whose working directory will move or whose application
# is being removed.
systemctl stop \
  ai-family-health-backend \
  ai-family-health-ocr \
  ai-leadgen-backend \
  ai-leadgen-lead-worker \
  ai-leadgen-wechat-event-worker \
  gooyoit-portal \
  platform-api \
  platform-web \
  platform-worker \
  passport-login \
  passport-admin
systemctl disable --now healthy-meals-plan.service || true

move_directory() {
  local source="$1"
  local destination="$2"
  if [[ ! -d "${source}" || -L "${source}" ]]; then
    echo "Expected source directory is missing or is a symlink: ${source}" >&2
    exit 1
  fi
  if [[ -e "${destination}" || -L "${destination}" ]]; then
    echo "Destination already exists: ${destination}" >&2
    exit 1
  fi
  mv "${source}" "${destination}"
}

replace_tree_path() {
  local root="$1"
  local old_path="$2"
  local new_path="$3"
  grep -rlI -- "${old_path}" "${root}" 2>/dev/null | while IFS= read -r file; do
    sed -i "s|${old_path}|${new_path}|g" "${file}"
  done
}

move_directory /opt/ai-leadgen-platform /data/apps/ai-leadgen-platform
ln -sfn /data/apps/ai-leadgen-platform/releases/20261028084331 /data/apps/ai-leadgen-platform/current
replace_tree_path /data/apps/ai-leadgen-platform /opt/ai-leadgen-platform /data/apps/ai-leadgen-platform

move_directory /opt/gooyoit-portal /data/apps/gooyoit-portal
move_directory /opt/wechat-marketing-platform /data/apps/wechat-marketing-platform
replace_tree_path /data/apps/wechat-marketing-platform /opt/wechat-marketing-platform /data/apps/wechat-marketing-platform

move_directory /opt/learnica /data/apps/learnica
move_directory /opt/learnica-pdf-worker /data/apps/learnica-pdf-worker
ln -sfn /data/apps/learnica-pdf-worker/releases/20260927-024448 /data/apps/learnica-pdf-worker/current

install -d -m 755 /data/apps/gooyoit-website
mv /var/www/gooyoit /data/apps/gooyoit-website/current

active_login_release="$(basename "$(dirname "$(readlink -f /var/www/passport/login)")")"
active_admin_release="$(basename "$(dirname "$(readlink -f /var/www/passport/admin)")")"

install -d -m 755 \
  /data/apps/gooyoit-passport/frontend/releases \
  /data/apps/gooyoit-passport-admin/frontend/releases

mv /data/apps/passport-gooyoit/login /data/apps/gooyoit-passport/backend
mv /data/apps/passport-gooyoit/admin /data/apps/gooyoit-passport-admin/backend
replace_tree_path /data/apps/gooyoit-passport/backend /data/apps/passport-gooyoit/login /data/apps/gooyoit-passport/backend
replace_tree_path /data/apps/gooyoit-passport-admin/backend /data/apps/passport-gooyoit/admin /data/apps/gooyoit-passport-admin/backend

for release_dir in /var/www/passport/releases/*; do
  [[ -d "${release_dir}" ]] || continue
  release="$(basename "${release_dir}")"
  if [[ -d "${release_dir}/login" ]]; then
    mv "${release_dir}/login" "/data/apps/gooyoit-passport/frontend/releases/${release}"
  fi
  if [[ -d "${release_dir}/admin" ]]; then
    mv "${release_dir}/admin" "/data/apps/gooyoit-passport-admin/frontend/releases/${release}"
  fi
  rmdir "${release_dir}"
done

mv /opt/passport-gooyoit/sdks /data/apps/gooyoit-passport/sdks
rmdir /opt/passport-gooyoit
rmdir /data/apps/passport-gooyoit
replace_tree_path /data/apps/wechat-marketing-platform/backend/.venv/lib/python3.12/site-packages \
  /opt/passport-gooyoit/sdks/python \
  /data/apps/gooyoit-passport/sdks/python

unlink /var/www/passport/login
unlink /var/www/passport/admin
rmdir /var/www/passport/releases
rmdir /var/www/passport
ln -s "/data/apps/gooyoit-passport/frontend/releases/${active_login_release}" /data/apps/gooyoit-passport/frontend/current
ln -s "/data/apps/gooyoit-passport-admin/frontend/releases/${active_admin_release}" /data/apps/gooyoit-passport-admin/frontend/current

# Rewrite service and Nginx references to canonical paths.
sed -i 's|/opt/ai-leadgen-platform|/data/apps/ai-leadgen-platform|g' \
  /etc/systemd/system/ai-leadgen-backend.service \
  /etc/systemd/system/ai-leadgen-frontend.service \
  /etc/systemd/system/ai-leadgen-lead-worker.service \
  /etc/systemd/system/ai-leadgen-wechat-event-worker.service \
  /etc/nginx/sites-available/ai-leadgen-3100.conf \
  /etc/nginx/sites-available/airadar.gooyoit.com.conf

sed -i 's|/opt/gooyoit-portal|/data/apps/gooyoit-portal|g' \
  /etc/systemd/system/gooyoit-portal.service

sed -i 's|/opt/wechat-marketing-platform|/data/apps/wechat-marketing-platform|g' \
  /etc/systemd/system/platform-api.service \
  /etc/systemd/system/platform-web.service \
  /etc/systemd/system/platform-worker.service

sed -i 's|/data/apps/passport-gooyoit/login|/data/apps/gooyoit-passport/backend|g' \
  /etc/systemd/system/passport-login.service
sed -i 's|/data/apps/passport-gooyoit/admin|/data/apps/gooyoit-passport-admin/backend|g' \
  /etc/systemd/system/passport-admin.service

sed -i 's|root /var/www/gooyoit;|root /data/apps/gooyoit-website/current;|' \
  /etc/nginx/conf.d/gooyoit.conf
sed -i 's|root /var/www/passport/login;|root /data/apps/gooyoit-passport/frontend/current;|' \
  /etc/nginx/sites-available/passport.gooyoit.com
sed -i 's|root /var/www/passport/admin;|root /data/apps/gooyoit-passport-admin/frontend/current;|' \
  /etc/nginx/sites-available/passport.gooyoit.com

# Retire the two explicitly removed applications. Keep the application files
# in the migration backup until the deployment has been fully verified.
systemctl disable ai-family-health-backend.service ai-family-health-ocr.service || true
for unit in \
  ai-family-health-backend.service \
  ai-family-health-ocr.service \
  healthy-meals-plan.service; do
  if [[ -f "/etc/systemd/system/${unit}" ]]; then
    mv "/etc/systemd/system/${unit}" "${backup_root}/retired/${unit}"
  fi
done

for site in api.ai-family-health.gooyoit.com healthy-meals-plan.conf; do
  if [[ -L "/etc/nginx/sites-enabled/${site}" ]]; then
    unlink "/etc/nginx/sites-enabled/${site}"
  fi
  if [[ -f "/etc/nginx/sites-available/${site}" ]]; then
    mv "/etc/nginx/sites-available/${site}" "${backup_root}/retired/${site}"
  fi
done

mv /data/apps/ai-family-health "${backup_root}/retired/ai-family-health"

systemctl daemon-reload
nginx -t
systemctl reload nginx

systemctl start \
  gooyoit-portal \
  ai-leadgen-backend \
  ai-leadgen-lead-worker \
  ai-leadgen-wechat-event-worker \
  platform-api \
  platform-web \
  platform-worker \
  passport-login \
  passport-admin

echo "MIGRATION_STAMP=${stamp}"
echo "BACKUP_ROOT=${backup_root}"
