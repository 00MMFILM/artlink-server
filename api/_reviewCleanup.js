// Called only with the account id returned by server-side auth.getUser.
export async function deleteReviewAssets(db, userId) {
  const {
    data: rooms,
    error
  } = await db.from('artlink_review_rooms').select('id').eq('owner_id', userId);
  if (error) {
    if (['42P01', 'PGRST205'].includes(error.code)) return 0;
    throw Error('review_room_lookup_failed');
  }
  const rpc = async (room, action) => {
    const r = await db.rpc('artlink_review_action', {
      p_user: userId,
      p_action: action,
      p_room: room,
      p_payload: {}
    });
    if (r.error) throw Error('review_room_delete_failed');
    return r.data;
  };
  for (const room of rooms || []) {
    await rpc(room.id, 'begin_delete');
    const paths = await rpc(room.id, 'paths');
    if (paths.length) {
      const {
        error
      } = await db.storage.from('review-media').remove(paths);
      if (error) throw Error('review_media_delete_failed');
    }
    await rpc(room.id, 'delete');
  }
  return (rooms || []).length;
}
