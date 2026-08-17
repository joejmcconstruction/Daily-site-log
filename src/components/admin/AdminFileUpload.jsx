import React, { useRef, useState } from "react";
import { Loader2, Paperclip, X, FileText, AlertCircle } from "lucide-react";
import { MAX_FILE_BYTES, compressImage, uid } from "../../lib/helpers";

// A single optional file/photo attachment — used for cert and training
// records, which store exactly one file_path/file_name each.
// value: { id, file, name, type, isImage, previewUrl } | null
export default function AdminFileUpload({ value, onChange, label = "Attach a file or photo" }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  async function handleChange(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    if (file.size > MAX_FILE_BYTES) {
      setError("File is over 10 MB.");
      return;
    }
    setBusy(true);
    try {
      const isImage = file.type.startsWith("image/");
      const processed = isImage ? await compressImage(file) : file;
      onChange({
        id: uid(),
        file: processed,
        name: file.name,
        type: processed.type || file.type,
        isImage,
        previewUrl: URL.createObjectURL(processed),
      });
    } catch (err) {
      console.error(err);
      setError("Couldn't process that file.");
    } finally {
      setBusy(false);
    }
  }

  if (value) {
    return (
      <div className="single-file-box" style={{ cursor: "default" }}>
        <div className="single-file-preview">
          {value.isImage ? <img src={value.previewUrl} alt={value.name} /> : <FileText size={18} color="var(--text-muted)" />}
        </div>
        <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {value.name}
        </div>
        <button type="button" className="file-thumb-remove" style={{ position: "static" }} onClick={() => onChange(null)}>
          <X size={12} color="#fff" />
        </button>
      </div>
    );
  }

  return (
    <div>
      <input ref={inputRef} type="file" accept="image/*,.pdf,.doc,.docx" onChange={handleChange} style={{ display: "none" }} />
      <button type="button" className="single-file-box" onClick={() => inputRef.current?.click()} disabled={busy}>
        {busy ? <Loader2 size={18} className="spin" color="var(--accent)" /> : <Paperclip size={18} color="var(--accent)" />}
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{busy ? "Processing..." : label}</span>
      </button>
      {error && (
        <div className="hint error" style={{ marginTop: 6 }}>
          <AlertCircle size={13} /> {error}
        </div>
      )}
    </div>
  );
}
