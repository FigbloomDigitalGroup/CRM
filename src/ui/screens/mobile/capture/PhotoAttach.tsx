"use client";

import { useRef } from "react";
import { useToast } from "../../../components/toast";
import { Icon } from "../../leads/icons";
import { describeError } from "../../../errors";
import { isNetworkFailure } from "../data";
import { addPhoto, usePhotos } from "./photos";
import { usePhotoUpload } from "./photoApi";

/**
 * "Add a photo" on a record (M4, FIG-1177): opens the phone's camera (a file input with `capture`), lists the record's photos, and says
 * "Waiting to sync" for one taken offline. Online, the photo is uploaded to the record's attachments (signed upload, content check, scan).
 */
export function PhotoAttach({ record }: { record: string }) {
  const input = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const { upload } = usePhotoUpload();
  const photos = usePhotos().filter((p) => p.record === record);

  return (
    <section aria-labelledby="m-photos" data-testid="mobile-photos">
      <h2 className="fb-m-h2" id="m-photos">
        Photos 
      </h2>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        className="fb-sr-only"
        aria-label="Take a photo"
        tabIndex={-1}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          const waiting = () => {
            addPhoto(record, file, false, file);
            toast.show({ message: "Saved on this phone. It sends when you are back online." });
          };
          if (typeof navigator !== "undefined" && navigator.onLine === false) return waiting();
          try {
            await upload(record, file);
            addPhoto(record, file, true);
            toast.show({ message: "Photo added." });
          } catch (err) {
            if (isNetworkFailure(err)) return waiting();
            const d = describeError(err);
            toast.show({ tone: "danger", message: `The photo was not added. ${d.kind === "validation" || d.kind === "conflict" ? d.body : d.kind === "noAccess" ? "Your role cannot attach files here." : "Try again in a moment."}` });
          }
        }}
      />
      <button type="button" className="fb-m-btn" onClick={() => input.current?.click()}>
        <Icon name="camera" size={17} />
        Add a photo
      </button>
      {photos.length > 0 ? (
        <ul className="fb-m-photos">
          {photos.map((p) => (
            <li key={p.id}>
              <Icon name="camera" size={15} />
              <span className="fb-m-photos__name">{p.name}</span>
              <span className="fb-m-photos__state" data-state={p.state}>
                {p.state === "WAITING" ? "Waiting to sync" : p.size}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
