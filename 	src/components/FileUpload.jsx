import React, { useRef, useState } from "react";
import { Loader2, X, FileText, AlertCircle } from "lucide-react";
import { MAX_FILE_BYTES, MAX_FILES, compressImage, uid } from "../lib/helpers";

// Holds files locally (not yet uploaded) until the parent form submits.
// Each item: { id, file (Blob/File), name, type, size, previewUrl, isImage, kind }
export default function FileUpload({ files, setFiles, accept, capture, label, icon: Icon, kind }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  async function handleChange(e) {
    const picked = Array.from(e.target.files || []);
    e.target.value = "";
    if (!picked.length) return;
    setError("");
    const room = MAX_FILES - files.length;
    if (room <= 0) {
      setError(`Max ${MAX_FILES} files reached.`);
      return;
    }
    const toProcess = picked.slice(0, room);
    setBusy(true);
    const results = [];
    for (const original of toProcess) {
      if (original.size > MAX_FILE_BYTES) {
        setError(`"${original.name}" is over 10 MB and was skipped.`);
        continue;
      }
      try {
        const isImage = original.type.startsWith("image/");
        const processed = isImage ? await compressImage(original) : original;
        results.push({
          id: uid(),
          file: processed,
          name: original.name,
          type: processed.type || original.type,
          size: processed.size,
          previewUrl: URL.createObjectURL(processed),
          isImage,
          kind,
        });
      } catch (err) {
        console.error(err);
        setError(`Couldn't process "${original.name}".`);
      }
    }
    setFiles((prev) => [...prev, ...results]);
    setBusy(false);
  }

  function removeFile(id) {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }

  return (
    <div>
      <input ref={inputRef} type="file" accept={accept} capture={capture} multiple onChange={handleChange} style={{ display: "none" }} />
      <button
        type="button"
        className="upload-box"
        onClick={() => inputRef.current?.click()}
        disabled={busy || files.length >= MAX_FILES}
      >
        {busy ? <Loader2 size={20} color="var(--accent)" className="spin" /> : <Icon size={20} color="var(--accent)" />}
        <span className="upload-title">{busy ? "Processing..." : label}</span>
        <span className="upload-sub">
          Up to {MAX_FILES} files · Max 10 MB per file · {files.length}/{MAX_FILES} added
        </span>
      </button>

      {error && (
        <div className="hint error" style={{ marginTop: 8 }}>
          <AlertCircle size={13} /> {error}
        </div>
      )}

      {files.length > 0 && (
        <div className="file-grid">
          {files.map((f) => (
            <div key={f.id} className="file-thumb">
              {f.isImage ? (
                <img src={f.previewUrl} alt={f.name} />
              ) : (
                <div className="file-thumb-doc">
                  <FileText size={18} color="var(--text-muted)" />
                  <span style={{ fontSize: 9, color: "var(--text-muted)", wordBreak: "break-word", lineHeight: 1.2 }}>
                    {f.name.slice(0, 18)}
                  </span>
                </div>
              )}
              <button type="button" className="file-thumb-remove" onClick={() => removeFile(f.id)}>
                <X size={12} color="#fff" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
