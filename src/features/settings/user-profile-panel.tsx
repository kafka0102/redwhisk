import { convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Camera } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Card, CardContent, Input } from "@/components/ui";
import { useAlertDialog } from "@/components/ui/use-alert-dialog";
import { getCommandErrorMessage } from "@/shared/commands/command-error";
import { useI18n } from "@/shared/i18n/i18n";

import { getUserProfile, updateUserProfile } from "./settings-commands";

const PROFILE_NAME_SAVE_DELAY_MS = 300;

export function UserProfilePanel() {
  const { t } = useI18n();
  const { alertDialog, showAlert } = useAlertDialog();
  const [name, setName] = useState("");
  const [avatarPath, setAvatarPath] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let isCurrent = true;

    void getUserProfile()
      .then((profile) => {
        if (!isCurrent) {
          return;
        }
        setName(profile.name);
        setAvatarPath(profile.avatarPath);
      })
      .catch((error: unknown) => {
        if (isCurrent) {
          showAlert({
            message: getCommandErrorMessage(error, t),
            type: "error",
          });
        }
      });

    return () => {
      isCurrent = false;
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, [showAlert, t]);

  function handleNameChange(nextName: string) {
    setName(nextName);
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(() => {
      void saveName(nextName);
    }, PROFILE_NAME_SAVE_DELAY_MS);
  }

  async function saveName(nextName: string) {
    try {
      const profile = await updateUserProfile({ name: nextName });
      setAvatarPath(profile.avatarPath);
    } catch (error) {
      showAlert({ message: getCommandErrorMessage(error, t), type: "error" });
    }
  }

  async function handleAvatarSelect() {
    try {
      const sourcePath = await open({
        directory: false,
        filters: [
          {
            extensions: ["png", "jpg", "jpeg", "webp"],
            name: t("globalSettings.imageFilterName"),
          },
        ],
        multiple: false,
      });
      if (!sourcePath || Array.isArray(sourcePath)) {
        return;
      }

      const profile = await updateUserProfile({ avatarSourcePath: sourcePath });
      setName(profile.name);
      setAvatarPath(profile.avatarPath);
    } catch (error) {
      showAlert({ message: getCommandErrorMessage(error, t), type: "error" });
    }
  }

  const profileLabel = t("globalSettings.profile");

  return (
    <>
      <section
        className="settings-section settings-section--user-profile"
        aria-label={profileLabel}
      >
        <div className="settings-section__header">
          <h3>{profileLabel}</h3>
        </div>
        <div className="settings-section__body">
          <Card>
            <CardContent className="grid gap-5 p-7">
              <section className="grid min-w-0 grid-cols-[120px_minmax(0,1fr)] items-center gap-x-6 gap-y-3">
                <h4 className="m-0 text-[15px] font-bold leading-[1.3]">
                  {t("globalSettings.avatar")}
                </h4>
                <button
                  className="group relative size-20 overflow-hidden rounded-full bg-muted"
                  type="button"
                  aria-label={t("globalSettings.avatarPickerLabel")}
                  onClick={() => void handleAvatarSelect()}
                >
                  {avatarPath ? (
                    <img
                      alt=""
                      className="size-full object-cover"
                      src={convertFileSrc(avatarPath)}
                    />
                  ) : null}
                  <span className="absolute inset-0 grid place-items-center bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                    <Camera aria-hidden="true" size={22} />
                  </span>
                </button>
              </section>
              <section className="grid min-w-0 grid-cols-[120px_minmax(0,1fr)] items-center gap-x-6 gap-y-3">
                <h4 className="m-0 text-[15px] font-bold leading-[1.3]">
                  {t("globalSettings.name")}
                </h4>
                <Input
                  aria-label={t("globalSettings.name")}
                  maxLength={20}
                  value={name}
                  onChange={(event) => handleNameChange(event.target.value)}
                />
              </section>
            </CardContent>
          </Card>
        </div>
      </section>
      {alertDialog}
    </>
  );
}
