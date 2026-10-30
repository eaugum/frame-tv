#!/bin/zsh
# Registers an existing certificate as a security profile (also after the folder has moved: the macOS keychain
# remembers the password under the certificate's path). The profile is named after the .p12 file.
# tizen/add-profile.sh [profile]   (without a name: the only certificate in tizen-studio-data/keystore/author/)
set -e
R=${0:A:h:h}
T=$R/tizen-studio/tools/ide/bin/tizen
A=$R/tizen-studio-data/keystore/author
P=$1
if [[ -z $P ]]; then
  FILES=($A/*.p12(N))
  (( $#FILES == 1 )) || { echo "Name the profile: tizen/add-profile.sh <name>, with <name>.p12 in $A."; exit 1; }
  P=${FILES[1]:t:r}
fi
[[ -e $A/$P.p12 ]] || { echo "$A/$P.p12 isn't there."; exit 1; }
read -s "PW?The password you chose for the certificate: "; echo
$T cli-config "default.profiles.path=$R/tizen-studio-data/profile/profiles.xml"
$T security-profiles remove -n $P >/dev/null 2>&1 || true
$T security-profiles add -f -n $P -a $A/$P.p12 -p "$PW" -A
$T security-profiles list
