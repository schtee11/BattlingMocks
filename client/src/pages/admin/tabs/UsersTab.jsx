import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../../lib/api.js';
import { Card } from '../../../components/ui/Card.jsx';
import { Button } from '../../../components/ui/Button.jsx';
import { Avatar } from '../../../components/ui/Avatar.jsx';
import { prettyName } from '../../../lib/displayName.js';

export default function UsersTab({ adminKey }) {
  const [users, setUsers] = useState([]);

  async function loadUsers() {
    try {
      const u = await api.adminListUsers(adminKey);
      setUsers(u);
    } catch (e) {
      toast.error(e.message);
    }
  }

  // Fetch users lazily the first time the Users tab opens, and refresh on
  // subsequent opens so a newly signed-up Discord user shows up without reload.
  useEffect(() => {
    loadUsers();
    // eslint-disable-next-line
  }, []);

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <h3 className="font-semibold text-text-primary">Signed Up ({users.length})</h3>
          <p className="text-text-muted text-xs mt-0.5">
            {users.filter((u) => u.has_mock).length} have submitted a mock.
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={loadUsers}>Refresh</Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left caption">
              <th className="px-3 py-2 font-display">Name</th>
              <th className="px-3 py-2 font-display text-center hidden sm:table-cell">Mock</th>
              <th className="px-3 py-2 font-display text-right">Score</th>
              <th className="px-3 py-2 font-display text-right hidden md:table-cell">Joined</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-text-muted">
                  No users yet.
                </td>
              </tr>
            ) : (
              users.map((u) => (
                <tr key={u.id} className="border-t border-border-subtle hover:bg-white/[0.02]">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2.5">
                      <Avatar url={u.avatar_url} name={u.display_name} size="xs" />
                      <span className="text-text-primary font-semibold truncate">
                        {prettyName(u.display_name)}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-center hidden sm:table-cell">
                    {u.has_mock ? (
                      <span className="text-emerald-400" title="Submitted a mock">✓</span>
                    ) : (
                      <span className="text-text-muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular">
                    {u.has_mock ? (
                      <span className={u.total_score > 0 ? 'text-gold' : 'text-text-secondary'}>
                        {u.total_score}
                      </span>
                    ) : (
                      <span className="text-text-muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-text-muted text-[11.5px] hidden md:table-cell">
                    {new Date(u.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
