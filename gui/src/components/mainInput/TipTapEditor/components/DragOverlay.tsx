import React, { useEffect } from "react";
import { HoverDiv, HoverTextDiv } from "./StyledComponents";

interface DragOverlayProps {
  show: boolean;
  setShow: (show: boolean) => void;
}

export const DragOverlay: React.FC<DragOverlayProps> = ({ show, setShow }) => {
  useEffect(() => {
    const overListener = (event: DragEvent) => {
      event.preventDefault();
      setShow(true);
    };
    window.addEventListener("dragover", overListener);

    const leaveListener = () => {
      setTimeout(() => setShow(false), 250);
    };
    window.addEventListener("dragleave", leaveListener);

    return () => {
      window.removeEventListener("dragover", overListener);
      window.removeEventListener("dragleave", leaveListener);
    };
  }, [setShow]);

  if (!show) return null;

  return (
    <>
      <HoverDiv />
      <HoverTextDiv>Drop files to attach</HoverTextDiv>
    </>
  );
};
