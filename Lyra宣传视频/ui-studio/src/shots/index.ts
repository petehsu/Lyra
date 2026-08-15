import masterShot from "../../shots/000-master/scene";
import logoRevealShot from "../../shots/001-logo-reveal/scene";
import logoToWorkbenchShot from "../../shots/002-logo-to-workbench/scene";
import openingSequenceShot from "../../shots/003-opening-sequence/scene";

const shots = [masterShot, logoRevealShot, logoToWorkbenchShot, openingSequenceShot] as const;
const requestedShotId = new URLSearchParams(window.location.search).get("shot");

export const activeShot =
  shots.find((shot) => shot.id === requestedShotId) ?? masterShot;
