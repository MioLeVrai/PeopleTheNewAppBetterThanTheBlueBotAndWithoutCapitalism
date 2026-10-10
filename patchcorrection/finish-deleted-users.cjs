// Apply once to the reviewed deletion helpers. Existing user data is not touched.
const fs = require('node:fs');
const file = 'server.js';
let source = fs.readFileSync(file, 'utf8');
if (source.includes('Keep messages and conversation IDs')) throw new Error('Deletion helpers already updated; review server.js instead of reapplying this historical patch.');
const begin = source.indexOf('async function peopleSimpleAdminDeleteLocal(');
const end = source.indexOf('// === PEOPLE_SIMPLE_ADMIN_DELETE_HELPERS_V1 ===', begin);
if (begin < 0 || end < 0) throw new Error('Deletion helper boundaries not found');
source = source.slice(0, begin) + `async function peopleSimpleAdminDeleteLocal(account) {
  const id = String(account.id);
  const accounts = peopleReadLocalAccounts();
  const number = Math.max(0, ...accounts.map(item => Number(String(item.password_hash || '').match(/^!deleted:(\\d+)$/)?.[1] || 0))) + 1;
  const name = 'Deleted User ' + number;
  const tombstone = { id: account.id, username: name, username_key: peopleUsernameKey(name), password_hash: '!deleted:' + number, description: '', created_at: new Date().toISOString() };
  peopleWriteLocalAccounts(accounts.map(item => String(item.id) === id ? tombstone : item));
  const social = peopleReadLocalSocial();
  social.friends = social.friends.filter(item => String(item.user_id) !== id && String(item.friend_id) !== id);
  social.friend_requests = social.friend_requests.filter(item => String(item.sender_id) !== id && String(item.recipient_id) !== id);
  // Keep messages and conversation IDs; their names resolve to the tombstone.
  peopleWriteLocalSocial(social);
  peopleWriteLocalGeneral(peopleReadLocalGeneral().map(item => String(item.senderId) === id ? { ...item, username: name } : item));
  const data = peopleReadLocalServers();
  data.members = data.members.filter(item => String(item.userId ?? item.user_id) !== id);
  data.memberRoles = (data.memberRoles || []).filter(item => String(item.userId ?? item.user_id) !== id);
  data.servers = data.servers.map(item => String(item.ownerId ?? item.owner_id) === id ? { ...item, ownerId: null, owner_id: null } : item);
  peopleWriteLocalServers(data);
  const avatars = peopleReadAvatarMeta(); delete avatars[id]; peopleWriteAvatarMeta(avatars);
  peopleWriteLocalE2ee(peopleReadLocalE2ee().filter(item => String(item.user_id) !== id));
  return tombstone;
}

async function peopleSimpleAdminDeleteAccount(username) {
  const account = await peopleFindAccount(username);
  if (!account || peopleSimpleDeletedAccounts.has(String(account.id))) return null;
  const id = String(account.id);
  let tombstone;
  if (peoplePool) {
    const client = await peoplePool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(734992101)');
      const numbers = await client.query("SELECT COALESCE(MAX(SUBSTRING(password_hash FROM 10)::bigint), 0) + 1 AS n FROM people_accounts WHERE password_hash ~ '^!deleted:[0-9]+$'");
      const number = String(numbers.rows[0].n), name = 'Deleted User ' + number;
      await client.query("UPDATE people_accounts SET username=$2, username_key=$3, password_hash=$4, description='', appearance_theme='dark', appearance_accent='', appearance_palette='', created_at=NOW() WHERE id=$1", [id, name, peopleUsernameKey(name), '!deleted:' + number]);
      await client.query('UPDATE people_general_messages SET username=$2 WHERE sender_id=$1', [id, name]);
      await client.query('UPDATE people_admin_audit SET actor_name=$2 WHERE actor_id=$1', [id, name]);
      await client.query('DELETE FROM people_friends WHERE user_id=$1 OR friend_id=$1', [id]);
      await client.query('DELETE FROM people_friend_requests WHERE sender_id=$1 OR recipient_id=$1', [id]);
      await client.query('DELETE FROM people_profile_avatars WHERE account_id=$1', [id]);
      await client.query('DELETE FROM people_e2ee_devices WHERE user_id=$1', [id]);
      await client.query('DELETE FROM people_server_members WHERE user_id=$1', [id]);
      await client.query('UPDATE people_servers SET owner_id=NULL WHERE owner_id=$1', [id]);
      await client.query('COMMIT');
      tombstone = { id, username: name };
    } catch (error) {
      await client.query('ROLLBACK'); throw error;
    } finally { client.release(); }
  } else tombstone = await peopleSimpleAdminDeleteLocal(account);
  peopleSimpleAdminKickAccount(id);
  peopleStatusPreferences.delete(id);
  await peopleDeleteAllEmptyServers();
  io.emit('people-account-deleted', { accountId: id, username: tombstone.username });
  return { id, username: tombstone.username };
}
` + source.slice(end);
fs.writeFileSync(file, source);
