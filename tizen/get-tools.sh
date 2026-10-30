#!/bin/zsh
# Fetches the parts of Samsung's Tizen tools that signing needs into tizen-studio/ (once). Samsung's own installer
# stops on a Mac without Rosetta, since it brings an Intel Java; these packages run on any Java 17.
set -e
R=${0:A:h:h}
S=$R/tizen-studio
REPO=https://download.tizen.org/sdk/tizenstudio/official
[[ ! -e $S/tools/ide/bin/tizen ]] || { echo "The Tizen tools are already in $S."; exit 0; }

JDK=
if whence -p brew >/dev/null; then JDK=$(brew --prefix openjdk@17)/libexec/openjdk.jdk; fi
[[ -x $JDK/Contents/Home/bin/java ]] || { echo "This needs Java 17: run \`brew install openjdk@17\` (https://brew.sh) and try again."; exit 1; }

W=$(mktemp -d)
trap 'rm -rf $W' EXIT
curl -fsS "$REPO/pkg_list_macos-64" -o $W/list
mkdir -p $S
for PKG in new-common-cli certificate-generator sdk-utils sdk-utils-core; do
  # Each package is a paragraph in the list, with its path and checksum.
  LINE=($(awk -v p="$PKG" 'BEGIN { RS = ""; FS = "\n" } $1 ~ "^Package : " p "$" {
    for (i = 1; i <= NF; i++) { split($i, f, " : "); if (f[1] == "Path") a = f[2]; if (f[1] == "SHA256") b = f[2] }
    print a, b }' $W/list))
  [[ -n $LINE[1] ]] || { echo "$PKG isn't in Samsung's package list."; exit 1; }
  echo "Fetching $PKG..."
  curl -fsS "$REPO$LINE[1]" -o $W/$PKG.zip
  [[ $(shasum -a 256 $W/$PKG.zip | cut -d' ' -f1) == $LINE[2] ]] || { echo "$PKG didn't match its checksum."; exit 1; }
  unzip -qo $W/$PKG.zip 'data/*' -d $W/$PKG
  cp -R $W/$PKG/data/. $S/
done
print -l "TIZEN_SDK_INSTALLED_PATH=$S" "TIZEN_SDK_DATA_PATH=$R/tizen-studio-data" "JDK_PATH=$JDK" > $S/sdk.info
chmod +x $S/tools/ide/bin/tizen $S/tools/ide/bin/tizen.sh
$S/tools/ide/bin/tizen version
echo "Done: the Tizen tools are in tizen-studio/."
