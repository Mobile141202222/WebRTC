import { useState, useRef } from 'react';
import { SendIcon, ImageIcon, CloseIcon } from './Icons.jsx';

function ChatComposer({ disabled, onSend }) {
  const [draft, setDraft] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const fileInputRef = useRef(null);

  async function handleFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const MAX_WIDTH = 800;
        const MAX_HEIGHT = 800;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height = Math.round(height * (MAX_WIDTH / width));
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width = Math.round(width * (MAX_HEIGHT / height));
            height = MAX_HEIGHT;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        setImageUrl(dataUrl);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function handleClearImage() {
    setImageUrl('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!draft.trim() && !imageUrl) {
      return;
    }

    const sent = await onSend({ text: draft, imageUrl });

    if (sent) {
      setDraft('');
      setImageUrl('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  return (
    <form className="composer" onSubmit={handleSubmit}>
      {imageUrl && (
        <div style={{ position: 'relative', width: 'max-content' }}>
          <img src={imageUrl} alt="preview" style={{ maxHeight: '120px', borderRadius: '12px', border: '1px solid var(--border-soft)' }} />
          <button 
            type="button" 
            onClick={handleClearImage}
            title="Remove image"
            style={{ position: 'absolute', top: -10, right: -10, width: 24, height: 24, borderRadius: '50%', background: 'var(--panel-strong)', border: '1px solid var(--border-soft)', display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--text-strong)' }}
          >
            <CloseIcon style={{ width: 14, height: 14 }} />
          </button>
        </div>
      )}
      <textarea
        className="composer-input"
        disabled={disabled}
        maxLength={420}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Send message..."
        rows={4}
        value={draft}
      />
      <div style={{ display: 'flex', gap: '12px' }}>
        <input 
          type="file" 
          accept="image/*" 
          onChange={handleFileChange} 
          ref={fileInputRef} 
          style={{ display: 'none' }} 
          id="chat-image-upload" 
          disabled={disabled}
        />
        <label htmlFor="chat-image-upload" className="secondary-button wide-button action-button" style={{ flex: '1', display: 'flex', alignItems: 'center', gap: '8px', cursor: disabled ? 'not-allowed' : 'pointer', justifyContent: 'center', opacity: disabled ? 0.6 : 1 }}>
          <ImageIcon />
          <span>Picture</span>
        </label>
        <button className="primary-button wide-button action-button" disabled={disabled || (!draft.trim() && !imageUrl)} type="submit" style={{ flex: '2' }}>
          <SendIcon />
          <span>Send</span>
        </button>
      </div>
    </form>
  );
}

export default ChatComposer;
