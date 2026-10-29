"use client";

import { useRef } from "react";
import { useToast } from "../../../components/toast";
import { DemoBadge } from "../../../demo/DemoBadge";
import { Icon } from "../../leads/icons";
import { addPhoto, usePhotos } from "./photos";

/**
 * "Add a photo" on a record (M4, FIG-1177): opens the phone's camera (a file input with `capture`), lists the record's photos, and says
 * "Waiting to sync" for one taken offline. Demo data until B6.22; the photo is not uploaded anywhere yet.
 */
export function PhotoAttach({ record }: { record: string }) {
  const input = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const photos = usePhotos().filter((p) => p.record === record);

  return (
    <section aria-labelledby="m-photos" data-testid="mobile-photos">
      <h2 className="fb-m-h2" id="m-photos">
        Photos <DemoBadge />
      </h2>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        className="fb-sr-only"
        aria-label="Take a photo"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          const photo = addPhoto(record, file);
          toast.show({ message: photo.state === "WAITING" ? "Saved on this phone. It sends when you are back online." : "Photo added." });
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
