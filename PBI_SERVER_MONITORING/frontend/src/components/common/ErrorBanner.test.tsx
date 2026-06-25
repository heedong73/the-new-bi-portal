/**
 * ErrorBanner 단위 테스트 (Requirements 19.1, 19.2).
 *
 * design.md "Frontend 오류 처리":
 *  - error=null/undefined면 렌더하지 않는다.
 *  - 502(Power BI 실패) 또는 errorCode `POWERBI_*`이면 한국어 prefix + errorDescription 표시.
 *  - 5xx 또는 네트워크 오류(status 0 / NETWORK_ERROR)일 때만 재시도 버튼 노출.
 *  - 4xx(검증 등)는 메시지만 표시(onRetry가 있어도 버튼 숨김).
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ErrorBanner from "./ErrorBanner";
import { ApiError } from "@/api/client";
import ko from "@/i18n/ko";

describe("ErrorBanner", () => {
  it("error가 null이면 아무것도 렌더하지 않는다", () => {
    const { container } = render(<ErrorBanner error={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("error가 undefined면 아무것도 렌더하지 않는다", () => {
    const { container } = render(<ErrorBanner error={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  describe("Power BI 오류 메시지 (19.2)", () => {
    it("status 502면 한국어 prefix + errorDescription을 표시한다", () => {
      const error = new ApiError({
        status: 502,
        errorCode: "POWERBI_UPSTREAM_5XX",
        errorDescription: "Power BI 서비스가 일시적으로 응답하지 않습니다.",
      });
      render(<ErrorBanner error={error} />);
      expect(
        screen.getByText(
          `${ko.common.errorPowerBi}: Power BI 서비스가 일시적으로 응답하지 않습니다.`
        )
      ).toBeInTheDocument();
    });

    it.each([
      "POWERBI_AUTH_ERROR",
      "POWERBI_FORBIDDEN",
      "POWERBI_RATE_LIMIT",
      "POWERBI_UPSTREAM_5XX",
      "POWERBI_ERROR",
    ])("errorCode %s 이면 Power BI 메시지로 표시한다", (errorCode) => {
      const error = new ApiError({
        status: 502,
        errorCode,
        errorDescription: "권한 오류",
      });
      render(<ErrorBanner error={error} />);
      expect(
        screen.getByText(`${ko.common.errorPowerBi}: 권한 오류`)
      ).toBeInTheDocument();
    });

    it("errorDescription이 없으면 prefix만 표시한다", () => {
      const error = new ApiError({ status: 502, errorCode: "POWERBI_AUTH_ERROR" });
      render(<ErrorBanner error={error} />);
      // ApiError는 errorCode를 message fallback으로 채우므로 desc로 POWERBI_AUTH_ERROR가 노출될 수 있음
      expect(screen.getByRole("alert")).toHaveTextContent(ko.common.errorPowerBi);
    });
  });

  describe("재시도 버튼 노출 조건 (19.1)", () => {
    it("5xx 오류 + onRetry면 재시도 버튼을 노출한다", () => {
      const onRetry = vi.fn();
      const error = new ApiError({ status: 500, errorCode: "INTERNAL_ERROR" });
      render(<ErrorBanner error={error} onRetry={onRetry} />);
      expect(
        screen.getByRole("button", { name: new RegExp(ko.common.retry) })
      ).toBeInTheDocument();
    });

    it("502(Power BI) 오류 + onRetry면 재시도 버튼을 노출한다", () => {
      const onRetry = vi.fn();
      const error = new ApiError({ status: 502, errorCode: "POWERBI_RATE_LIMIT" });
      render(<ErrorBanner error={error} onRetry={onRetry} />);
      expect(
        screen.getByRole("button", { name: new RegExp(ko.common.retry) })
      ).toBeInTheDocument();
    });

    it("네트워크 오류(status 0 / NETWORK_ERROR) + onRetry면 재시도 버튼을 노출한다", () => {
      const onRetry = vi.fn();
      const error = new ApiError({ status: 0, errorCode: "NETWORK_ERROR" });
      render(<ErrorBanner error={error} onRetry={onRetry} />);
      expect(
        screen.getByRole("button", { name: new RegExp(ko.common.retry) })
      ).toBeInTheDocument();
    });

    it("4xx(검증 오류)는 onRetry가 있어도 재시도 버튼을 숨긴다", () => {
      const onRetry = vi.fn();
      const error = new ApiError({
        status: 400,
        errorCode: "VALIDATION_ERROR",
        errorDescription: "잘못된 날짜 형식입니다.",
      });
      render(<ErrorBanner error={error} onRetry={onRetry} />);
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      expect(screen.getByText("잘못된 날짜 형식입니다.")).toBeInTheDocument();
    });

    it("onRetry가 없으면 재시도 버튼을 표시하지 않는다", () => {
      const error = new ApiError({ status: 500, errorCode: "INTERNAL_ERROR" });
      render(<ErrorBanner error={error} />);
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });

    it("재시도 버튼 클릭 시 onRetry가 호출된다", () => {
      const onRetry = vi.fn();
      const error = new ApiError({ status: 503, errorCode: "QUEUE_UNAVAILABLE" });
      render(<ErrorBanner error={error} onRetry={onRetry} />);
      fireEvent.click(screen.getByRole("button", { name: new RegExp(ko.common.retry) }));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });
  });

  describe("일반 오류 메시지 변환", () => {
    it("문자열 오류는 그대로 표시하고 재시도 버튼을 노출한다", () => {
      const onRetry = vi.fn();
      render(<ErrorBanner error="문제가 발생했습니다." onRetry={onRetry} />);
      expect(screen.getByText("문제가 발생했습니다.")).toBeInTheDocument();
      expect(screen.getByRole("button")).toBeInTheDocument();
    });

    it("errorDescription이 없는 4xx는 기본 backend 메시지를 표시한다", () => {
      const error = new ApiError({ status: 404 });
      render(<ErrorBanner error={error} onRetry={vi.fn()} />);
      // 404는 message fallback으로 status 기반 기본 메시지가 채워짐 → 최소한 alert 렌더
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });
  });
});
