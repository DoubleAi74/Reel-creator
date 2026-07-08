export function serializeCard(card) {
  return {
    id: card._id.toString(),
    title: card.title,
    number: card.number,
    colour: card.colour,
    createdAt: card.createdAt?.toISOString() ?? null,
  };
}
