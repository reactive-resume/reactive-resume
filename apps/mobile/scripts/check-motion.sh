#!/bin/sh
# Static motion checks (design/MOTION.md §10.1). Run from anywhere; prints nothing and exits 0 when clean.
# Uses ripgrep when installed, else find + grep with the same patterns and exclusions.
cd "$(dirname "$0")/.." || exit 2

# search <pattern> [excluded path prefix]
search() {
	if command -v rg >/dev/null 2>&1; then
		if [ -n "$2" ]; then rg -n "$1" src app --glob "!$2**"; else rg -n "$1" src app; fi
	else
		find src app -type f ! -path "${2:-//none}*" -print0 2>/dev/null | xargs -0 grep -nE "$1" 2>/dev/null
	fi
}

out=$(
	search 'withTiming\(|withSpring\(|withDecay\(|Animated\.timing|Animated\.spring|LayoutAnimation' 'src/ui/'
	search "from 'expo-haptics'|from \"expo-haptics\"" 'src/ui/motion'
	search 'TouchableOpacity|TouchableHighlight|TouchableWithoutFeedback|<Pressable|android_ripple' 'src/ui/'
	search 'duration: ?[0-9]|Easing\.(bezier|in|out|inOut)' 'src/ui/'
	search '@react-navigation/native-stack|createNativeStackNavigator'
	search '[Hh]old ?to ?delete|holdFill|HoldToDelete'
)
[ -z "$out" ] && exit 0
printf '%s\n' "$out"
exit 1
