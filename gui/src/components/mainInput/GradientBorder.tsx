import styled, { keyframes } from "styled-components";

const progressPulse = keyframes`
  0%, 100% { box-shadow: 0 0 0 0 transparent; }
  50% {
    box-shadow: 0 0 0 1px
      color-mix(in srgb, var(--vscode-focusBorder, #007acc) 48%, transparent);
  }
`;

export const GradientBorder = styled.div<{
  borderRadius?: string;
  borderColor?: string;
  loading: 0 | 1;
}>`
  border-radius: ${(props) => props.borderRadius || "0"};
  padding: 1px;
  background: ${(props) =>
    props.loading
      ? "var(--vscode-progressBar-background, var(--vscode-focusBorder, #007acc))"
      : (props.borderColor ?? "transparent")};
  animation: ${(props) => (props.loading ? progressPulse : "")} 1.4s ease-in-out
    infinite;
  width: 100%;
  display: flex;
  flex-direction: row;
  align-items: center;
  margin-top: 0;
`;
