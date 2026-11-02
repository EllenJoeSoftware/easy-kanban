import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useInvalidate, showError } from '../queries';
import { Modal } from '../ui';

const ICONS = ['🤖', '📋', '🚀', '🐔', '📰', '💼', '🧪', '📱', '💡', '🏠'];

export default function NewBoardModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('🤖');
  const [color, setColor] = useState('#6366f1');
  const [template, setTemplate] = useState<'agents' | 'simple' | 'empty'>('agents');
  const inv = useInvalidate();
  const navigate = useNavigate();
  const create = async () => {
    if (!name.trim()) return;
    try {
      const b = await api.createBoard({ name: name.trim(), icon, color, template });
      inv(['boards']);
      setName('');
      onClose();
      navigate(`/b/${b.id}`);
    } catch (e) { showError(e); }
  };
  return (
    <Modal open={open} onClose={onClose} title="New board" footer={<>
      <button className="btn ghost" onClick={onClose}>Cancel</button>
      <button className="btn primary" onClick={create} disabled={!name.trim()}>Create board</button>
    </>}>
      <label className="field"><span>Name</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Stroke 5 News pipeline" onKeyDown={(e) => e.key === 'Enter' && create()} />
      </label>
      <div className="field"><span>Icon</span>
        <div className="icon-pick">{ICONS.map((i) => <button key={i} className={i === icon ? 'active' : ''} onClick={() => setIcon(i)}>{i}</button>)}</div>
      </div>
      <label className="field"><span>Colour</span><input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>
      <div className="field"><span>Template</span>
        <div className="template-pick">
          {([
            ['agents', 'Agent workflow', 'Backlog → To Do → In Progress → Review → Done'],
            ['simple', 'Simple', 'To Do → Doing → Done'],
            ['empty', 'Empty', 'Add your own columns'],
          ] as const).map(([k, t, d]) => (
            <button key={k} className={`template ${template === k ? 'active' : ''}`} onClick={() => setTemplate(k)}>
              <b>{t}</b><span>{d}</span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
