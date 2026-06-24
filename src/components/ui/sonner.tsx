import { useTheme } from "../../shared/i18n/i18n";
import { Toaster as Sonner, type ToasterProps, toast } from "sonner";
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  XCircleIcon,
  Loader2Icon,
} from "lucide-react";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster"
      toastOptions={{
        classNames: {
          toast: "sonner-toast",
        },
      }}
      icons={{
        success: <CircleCheckIcon size={18} />,
        info: <InfoIcon size={18} />,
        warning: <TriangleAlertIcon size={18} />,
        error: <XCircleIcon size={18} />,
        loading: <Loader2Icon size={18} className="animate-spin" />,
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
