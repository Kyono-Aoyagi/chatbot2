export const SAMPLE_PYTHON_CODE = `def bubble_sort(numbers):
    n = len(numbers)
    for i in range(n):
        swapped = False
        for j in range(0, n - i - 1):
            if numbers[j] > numbers[j + 1]:
                numbers[j], numbers[j + 1] = numbers[j + 1], numbers[j]
                swapped = True
        if not swapped:
            break
    return numbers


values = [64, 34, 25, 12, 22, 11, 90]
sorted_values = bubble_sort(values)
print(sorted_values)
`
