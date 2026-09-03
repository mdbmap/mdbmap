#!/usr/bin/env bash
set -euo pipefail

root="${1:-dist}"
if [[ ! -d "$root" ]]; then
	echo "missing build output directory: $root" >&2
	exit 1
fi

mapfile -t named < <(find "$root" -type f -iname '*devtools*' -print)
if ((${#named[@]} > 0)); then
	echo "Production dist contains Devtools-named assets:" >&2
	printf '  %s\n' "${named[@]}" >&2
	exit 1
fi

markers=(
	'@tanstack/react-devtools'
	'@tanstack/react-query-devtools'
	'@tanstack/react-router-devtools'
	'TanStackDevtools'
	'ReactQueryDevtoolsPanel'
	'TanStackRouterDevtoolsPanel'
)

hits=()
while IFS= read -r -d '' file; do
	for marker in "${markers[@]}"; do
		if grep -F -q -- "$marker" "$file"; then
			hits+=("$file → $marker")
		fi
	done
done < <(find "$root" -type f \( -name '*.js' -o -name '*.mjs' -o -name '*.cjs' -o -name '*.css' -o -name '*.html' \) -print0)

if ((${#hits[@]} > 0)); then
	echo "Production dist still references TanStack Devtools:" >&2
	printf '  %s\n' "${hits[@]}" >&2
	exit 1
fi

echo "Devtools production strip OK (no TanStack Devtools markers in dist)."
echo "Client JS spot-check:"
if [[ -d "$root/client/assets" ]]; then
	find "$root/client/assets" -type f -name '*.js' -printf '%s\t%p\n' |
		sort -nr |
		head -n 5 |
		awk '{ printf "  %.1f KiB  %s\n", $1/1024, $2 }'
fi
