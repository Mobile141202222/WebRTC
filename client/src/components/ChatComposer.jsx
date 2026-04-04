import { useState } from 'react';

function ChatComposer({ disabled, onSend }) {
  const [draft, setDraft] = useState('');

  async function handleSubmit(event) {
    event.preventDefault();

    const sent = await onSend(draft);

    if (sent) {
      setDraft('');
    }
  }

  return (
    <form className="composer" onSubmit={handleSubmit}>
      <textarea
        className="composer-input"
        disabled={disabled}
        maxLength={420}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Drop a quick update, invite note, or voice check..."
        rows={3}
        value={draft}
      />
      <button className="primary-button" disabled={disabled || !draft.trim()} type="submit">
        Send message
      </button>
    </form>
  );
}

export default ChatComposer;
