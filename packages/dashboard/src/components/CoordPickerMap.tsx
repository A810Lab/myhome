import React, { useEffect, useRef } from "react";
import { useKakaoMap } from "../useKakaoMap";
import { MapPin } from "lucide-react";

interface CoordPickerMapProps {
  lat: number | null;
  lng: number | null;
  regionName: string;
  complexName: string;
  onSelectCoords: (lat: number, lng: number) => void;
}

export function CoordPickerMap({
  lat,
  lng,
  regionName,
  complexName,
  onSelectCoords
}: CoordPickerMapProps) {
  const { loaded, error } = useKakaoMap();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);

  // onSelectCoords를 최신 참조로 유지하기 위해 ref 사용 (의존성 최소화)
  const onSelectCoordsRef = useRef(onSelectCoords);
  useEffect(() => {
    onSelectCoordsRef.current = onSelectCoords;
  }, [onSelectCoords]);

  useEffect(() => {
    if (!loaded || !mapContainerRef.current || mapRef.current) return;

    const kakao = (window as any).kakao;
    if (!kakao || !kakao.maps) return;

    // 기본 위치: 서울시청
    let initialLatLng = new kakao.maps.LatLng(37.566524, 126.978058);
    const options = {
      center: initialLatLng,
      level: 4
    };

    const map = new kakao.maps.Map(mapContainerRef.current, options);
    mapRef.current = map;

    // 클릭 지점에 표시할 마커 생성 (초기에는 지도에 노출하지 않음)
    const marker = new kakao.maps.Marker({
      position: initialLatLng
    });
    markerRef.current = marker;

    // 지도 클릭 이벤트 리스너 등록
    kakao.maps.event.addListener(map, "click", (mouseEvent: any) => {
      const latlng = mouseEvent.latLng;
      const clickedLat = latlng.getLat();
      const clickedLng = latlng.getLng();

      marker.setPosition(latlng);
      marker.setMap(map);

      onSelectCoordsRef.current(clickedLat, clickedLng);
    });

    // 기존 위도/경도가 존재하는 경우 바로 마커 표시 및 중심으로 이동
    if (lat && lng) {
      const pos = new kakao.maps.LatLng(lat, lng);
      map.setCenter(pos);
      marker.setPosition(pos);
      marker.setMap(map);
    } else {
      // 좌표가 없는 경우, '지역명 + 단지명' 혹은 '지역명'으로 검색해서 현재 주소 위치로 이동 후 마커 표시
      const geocoder = new kakao.maps.services.Geocoder();
      const cleanComplexName = complexName.replace(/\(.*?\)/g, "").trim();
      const searchQuery = `${regionName} ${cleanComplexName}`;

      geocoder.addressSearch(searchQuery, (result: any[], status: string) => {
        if (status === "OK" && result[0]) {
          const foundLat = parseFloat(result[0].y);
          const foundLng = parseFloat(result[0].x);
          const pos = new kakao.maps.LatLng(foundLat, foundLng);
          
          map.setCenter(pos);
          marker.setPosition(pos);
          marker.setMap(map);
          // 입력 폼에 주소 좌표를 자동으로 설정해줌
          onSelectCoordsRef.current(foundLat, foundLng);
        } else {
          // 단지명 조합 검색 실패 시 지역명만으로 재검색
          geocoder.addressSearch(regionName, (resultSub: any[], statusSub: string) => {
            if (statusSub === "OK" && resultSub[0]) {
              const foundLat = parseFloat(resultSub[0].y);
              const foundLng = parseFloat(resultSub[0].x);
              const pos = new kakao.maps.LatLng(foundLat, foundLng);
              
              map.setCenter(pos);
              marker.setPosition(pos);
              marker.setMap(map);
              onSelectCoordsRef.current(foundLat, foundLng);
            }
          });
        }
      });
    }

    return () => {
      if (mapRef.current) {
        mapRef.current = null;
      }
    };
  }, [loaded, lat, lng, regionName, complexName]);

  // 상위 상태(예: 리셋 또는 수동 입력값 수정)에 반응하여 마커 위치 갱신
  useEffect(() => {
    if (!loaded || !mapRef.current || !markerRef.current) return;
    const kakao = (window as any).kakao;
    if (!kakao || !kakao.maps) return;

    if (lat && lng) {
      const pos = new kakao.maps.LatLng(lat, lng);
      markerRef.current.setPosition(pos);
      markerRef.current.setMap(mapRef.current);
    } else {
      markerRef.current.setMap(null);
    }
  }, [lat, lng, loaded]);

  if (error) {
    return (
      <div className="flex h-[280px] w-full flex-col items-center justify-center rounded-xl border border-red-200/60 bg-red-500/5 p-4 text-center">
        <MapPin className="h-6 w-6 text-red-500 mb-2" />
        <p className="text-xs font-semibold text-red-600">지도를 불러오는 데 실패했습니다.</p>
        <p className="text-[10px] text-neutral mt-1">API 키 도메인 설정을 확인해 주세요.</p>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="flex h-[280px] w-full flex-col items-center justify-center rounded-xl border border-normal bg-alternative/40 p-4 text-center">
        <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin mb-3" />
        <p className="text-xs text-neutral">카카오 지도를 로딩 중입니다...</p>
      </div>
    );
  }

  return (
    <div className="relative w-full h-[280px] rounded-xl overflow-hidden border border-normal shadow-sm">
      <div ref={mapContainerRef} className="w-full h-full" />
      <div className="absolute top-2 left-2 z-10 bg-elevated/95 backdrop-blur-sm border border-normal rounded-lg px-2.5 py-1 text-[10px] font-bold text-neutral">
        💡 지도에서 원하는 위치를 클릭하면 위도와 경도가 자동으로 입력됩니다.
      </div>
    </div>
  );
}
