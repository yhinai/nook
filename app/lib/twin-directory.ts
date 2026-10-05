export function addCircleName(friends: string[], input: string): string[] {
  const name = input.trim();
  if (!name || name.length > 30 || friends.length >= 100 || friends.some(friend => friend.toLowerCase() === name.toLowerCase())) return friends;
  return [...friends, name];
}
