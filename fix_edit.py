with open('script.js', 'r', encoding='utf-8', errors='replace') as f:
    content = f.read()

# Find the end of beginUserEdit — the two lines before closing brace
OLD = "  syncSlotField();\n  syncUserPlanDates();\n}"
NEW = """  if ($('userSportInput')) {
    $('userSportInput').value = u.sport || 'General';
    syncUserLevelOptions();
    $('userLevelInput').value = u.membershipLevel || '';
  }
  syncSlotField();
  syncUserPlanDates();
}"""

# We need to find only the one inside beginUserEdit (not resetUserForm which also has syncSlotField/syncUserPlanDates)
# beginUserEdit ends before deleteUser, so find first occurrence
idx = content.find(OLD)
count = 0
while idx != -1:
    count += 1
    print(f"Occurrence {count} at index {idx}")
    print(repr(content[idx-100:idx+len(OLD)+10]))
    print("---")
    idx = content.find(OLD, idx + 1)

print(f"Total occurrences: {count}")
