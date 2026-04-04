import { useState } from 'react';
import { SendIcon } from './Icons.jsx';

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
        placeholder="Send message..."
        rows={4}
        value={draft}
      />
      <button className="primary-button wide-button action-button" disabled={disabled || !draft.trim()} type="submit">
        <SendIcon />
        <span>Send</span>
      </button>
    </form>
  );
}

export default ChatComposer;
