if ! command -v zipgrep &> /dev/null; then
    echo "Zipgrep could not be found. Exiting..."
    exit 1
fi

matching_mods=()
for file in $(find mods -type f -name "mod.zip"); do
    result=$(zipgrep '"modules"' "$file")
    if [[ -n "$result" ]]; then
        found+=("$(basename "$(dirname "$file")")")
    fi
done

echo "Module usage found in: ${found[@]}"
