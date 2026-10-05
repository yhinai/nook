// Sample profiles help people explore their circle without claiming a live connection.
export const sampleTwins = [
  { name: "Maya", initials: "MA", color: "maya", about: "Good food, long walks, and making time for friends.", values: ["Time with people", "Wellbeing"] },
  { name: "Sam", initials: "SA", color: "sam", about: "Creative projects, coffee catch-ups, and new ideas.", values: ["Learning", "Meaningful work"] },
  { name: "Jordan", initials: "JO", color: "jordan", about: "Weekend adventures, being outdoors, and finding balance.", values: ["Freedom", "Wellbeing"] },
];

export function addCircleName(friends: string[], input: string): string[] {
  const name = input.trim();
  if (!name || name.length > 30 || friends.length >= 100 || friends.some(friend => friend.toLowerCase() === name.toLowerCase())) return friends;
  return [...friends, name];
}
