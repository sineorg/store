if ! command -v jq &> /dev/null; then
    echo "Jq could not be found. Exiting..."
    exit 1
fi

echo "Initializing..."
mods="$(cat marketplace.json | jq -c .[])"
echo

specifies_ai=$(echo "$mods" | jq -c 'select(.ai != null) | .id' | tr '\n' ' ')
no_ai=$(echo "$mods" | jq -c 'select(.ai == "no") | .id' | tr '\n' ' ')
partial_ai=$(echo "$mods" | jq -c 'select(.ai == "partial") | .id' | tr '\n' ' ')
all_ai=$(echo "$mods" | jq -c 'select(.ai == "yes") | .id' | tr '\n' ' ')
other=$(echo "$mods" | jq -c 'select(.ai != null and .ai != "no" and .ai != "partial" and .ai != "yes") | .id' | tr '\n' ' ')
no_specify=$(echo "$mods" | jq -c 'select(.ai == null) | .id' | tr '\n' ' ')

echo "$(echo "$mods" | jq -s 'length')"
echo -e "\nSpecifies AI: $specifies_ai"
echo "No AI: $no_ai"
echo "Partial AI: $partial_ai"
echo "Doomed AI slop: $all_ai"
echo "Other: $other"

echo -e "\nDo not specify:\n$no_specify\n"

