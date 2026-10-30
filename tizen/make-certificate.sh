#!/bin/zsh
# Makes your own Tizen author certificate and the security profile that signs Frame TV (once).
# tizen/make-certificate.sh [profile]   (without a name the profile is frametv)
set -e
R=${0:A:h:h}
T=$R/tizen-studio/tools/ide/bin/tizen
P=${1:-frametv}
K=$R/tizen-studio-data/keystore/author/$P.p12
[[ -x $T ]] || { echo "The Tizen tools aren't there: run tizen/get-tools.sh first."; exit 1; }
[[ ! -e $K ]] || { echo "$K already exists. Keep it: updates must be signed with it."; exit 1; }
read "WHO?Your name, for the certificate: "
[[ -n $WHO ]] || { echo "The certificate needs a name."; exit 1; }
read -s "PW?Choose a password for the certificate (at least 8 characters): "; echo
read -s "PW2?Repeat the password: "; echo
[[ "$PW" == "$PW2" ]] || { echo "The passwords didn't match."; exit 1; }
$T cli-config "default.profiles.path=$R/tizen-studio-data/profile/profiles.xml"
$T certificate -a $P -p "$PW" -n "$WHO" -f $P
$T security-profiles add -f -n $P -a $K -p "$PW" -A
echo "Done: the profile $P is ready. Keep $K and the password safe."
