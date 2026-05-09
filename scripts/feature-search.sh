if ! command -v jq &> /dev/null; then
    echo "Jq could not be found. Exiting..."
    exit 1
fi

echo "Initializing..."
mods="$(cat marketplace.json | jq -c .[])"
echo

read -p "Enter feature to search for: " feature
echo

matching_mods=()
count=0
echo "Parsing"
while IFS= read -r line; do
    result="$(echo "$line" | grep "\"$feature\":")"
    if [[ -n "$result" ]]; then
	matching_mods+=("$(echo "$line" | jq -c .id)")
    fi
    count=$((count + 1))
    echo -n "($count) "
done <<< "$mods"

echo -e "\n\nModule usage found in (${#matching_mods[@]}): ${matching_mods[@]}\n"
