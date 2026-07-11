import styled from "styled-components";
import { defaultBorderRadius, lightGray, vscForeground } from "../..";
import { getFontSize } from "../../../util";

export const NewSessionButton = styled.button`
  width: fit-content;
  margin-right: auto;
  margin-left: 6px;
  margin-top: 2px;
  margin-bottom: 8px;
  font-size: ${getFontSize() - 2}px;

  border-radius: ${defaultBorderRadius};
  padding: 2px 6px;
  color: ${lightGray};
  background: transparent;
  border: 0;

  &:hover {
    background-color: ${lightGray}33;
    color: ${vscForeground};
  }

  cursor: pointer;
`;
